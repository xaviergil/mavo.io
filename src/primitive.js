(function($, $$) {

const DISABLE_CACHE = false;

var _ = Wysie.Primitive = $.Class({
	extends: Wysie.Unit,
	constructor: function (element, wysie, collection) {
		// Which attribute holds the data, if any?
		// "null" or null for none (i.e. data is in content).
		this.attribute = _.getValueAttribute(this.element);

		// What is the datatype?
		this.datatype = _.getDatatype(this.element, this.attribute);

		/**
		 * Set up input widget
		 */

		// Exposed widgets (visible always)
		if (Wysie.is("formControl", this.element)) {
			this.editor = this.element;

			if (this.exposed) {
				// Editing exposed elements saves the wysie
				this.element.addEventListener("change", evt => {
					if (!this.wysie.editing && evt.target === this.editor && (this.scope.everSaved || !this.scope.collection)) {
						this.wysie.save();
					}
				});

				this.edit();
			}
		}
		// Nested widgets
		else if (!this.editor) {
			this.editor = $$(this.element.children).filter(function (el) {
			    return el.matches(Wysie.selectors.formControl) && !el.matches(Wysie.selectors.property);
			})[0];

			$.remove(this.editor);
		}

		this.templateValue = this.value;

		this.default = this.element.getAttribute("data-default");

		if (this.default === "") { // attribute exists, no value, default is template value
			this.default = this.templateValue;
		}
		else {
			if (this.default === null) { // attribute does not exist
				this.default = this.editor? this.editorValue : this.emptyValue;
			}

			this.value = this.default;
		}

		this.update(this.value);

		// Observe future mutations to this property, if possible
		// Properties like input.checked or input.value cannot be observed that way
		// so we cannot depend on mutation observers for everything :(
		this.observer = Wysie.observe(this.element, this.attribute, record => {
			this.observer.disconnect();

			if (this.attribute) {
				var value = this.value;

				if (record[0].oldValue != value) {
					this.update(value);
				}
			}
			else if (!this.editing) {
				this.update(this.value);
			}

			Wysie.observe(this.element, this.attribute, this.observer, true);
		}, true);

		if (this.collection) {
			// Collection of primitives, deal with setting textContent etc without the UI interfering.
			var swapUI = callback => {
				this.observer.disconnect();
				var ui = $.remove($(Wysie.selectors.ui, this.element));

				var ret = callback();

				$.inside(ui, this.element);
				Wysie.observe(this.element, this.attribute, this.observer);

				return ret;
			};

			// Intercept certain properties so that any Wysie UI inside this primitive will not be destroyed
			["textContent", "innerHTML"].forEach(property => {
				var descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");

				Object.defineProperty(this.element, property, {
					get: function() {
						return swapUI(() => descriptor.get.call(this));
					},

					set: function(value) {
						swapUI(() => descriptor.set.call(this, value));
					}
				});
			});
		}
	},

	get value() {
		if (this.editing) {
			return this.editorValue;
		}

		return _.getValue(this.element, this.attribute, this.datatype);
	},

	set value(value) {
		if (this.editing) {
			this.editorValue = value;
		}

		_.setValue(this.element, value, this.attribute, this.datatype);

		if (Wysie.is("formControl", this.element) || !this.attribute) {
			// Mutation observer won't catch this, so we have to call update manually
			this.update(value);
		}
	},

	get editorValue() {
		if (this.editor) {
			if (this.editor.matches(Wysie.selectors.formControl)) {
				return _.getValue(this.editor, undefined, this.datatype);
			}

			// if we're here, this.editor is an entire HTML structure
			var output = $(Wysie.selectors.output + ", " + Wysie.selectors.formControl, this.editor);

			if (output) {
				return output._.data.unit ? output._.data.unit.value : _.getValue(output);
			}
		}
	},

	set editorValue(value) {
		if (this.editor) {
			if (this.editor.matches(Wysie.selectors.formControl)) {
				_.setValue(this.editor, value);
			}
			else {
				// if we're here, this.editor is an entire HTML structure
				var output = $(Wysie.selectors.output + ", " + Wysie.selectors.formControl, this.editor);

				if (output) {
					if (output._.data.unit) {
						output._.data.unit.value = value;
					}
					else {
						_.setValue(output, value);
					}
				}
			}
		}
	},

	get exposed() {
		return this.editor === this.element;
	},

	getData: function(o) {
		o = o || {};

		if (this.computed && !o.computed) {
			return null;
		}

		var ret = this.editing && !o.dirty && !this.exposed? this.savedValue : this.value;

		if (!o.dirty && ret === "" && ret === this.default) {
			return null;
		}

		return ret;
	},

	update: function (value) {
		this.empty = value === "" || value === null;

		value = value || value === 0? value : "";

		if (this.humanReadable && this.attribute) {
			this.element.textContent = this.humanReadable(value);
		}

		var evt = {
			property: this.property,
			value: value,
			wysie: this.wysie,
			unit: this,
			dirty: this.editing
		};

		this.element._.fire("wysie:propertychange", evt);
		this.element._.fire("wysie:datachange", evt);
	},

	save: function () {
		if (this.popup) {
			this.hidePopup();
		}
		else if (!this.attribute && !this.exposed && this.editing) {
			this.element.textContent = this.editorValue;
			$.remove(this.editor);
		}

		if (!this.exposed) {
			this.editing = false;
		}

		// Revert tabIndex
		if (this.element._.data.prevTabindex !== null) {
			this.element.tabIndex = this.element._.data.prevTabindex;
		}
		else {
			this.element.removeAttribute("tabindex");
		}

		this.element._.unbind(".wysie:edit .wysie:preedit .wysie:showpopup");

		this.element._.fire("wysie:propertysave", {
			unit: this
		});
	},

	cancel: function() {
		if (this.savedValue !== undefined) {
			// FIXME if we have a collection of properties (not scopes), this will cause
			// cancel to not remove new unsaved items
			// This should be fixed by handling this on the collection level.
			this.value = this.savedValue;
		}

		this.save();
	},

	// Prepare to be edited
	// Called when root edit button is pressed
	preEdit: function () {
		// Empty properties should become editable immediately
		// otherwise they could be invisible!
		if (this.empty && !this.attribute) {
			this.edit();
			return;
		}

		this.element._.events({
			// click is needed too because it works with the keyboard as well
			"mousedown.wysie:preedit click.wysie:preedit": e => this.edit(),
			"focus.wysie:preedit": e => {
				this.edit();

				if (!this.popup) {
					this.editor.focus();
				}
			},
			"click.wysie:edit": evt => {
				// Prevent default actions while editing
				// e.g. following links etc
				if (!this.exposed) {
					evt.preventDefault();
				}
			}
		});

		// Make element focusable, so it can actually receive focus
		this.element._.data.prevTabindex = this.element.getAttribute("tabindex");
		this.element.tabIndex = 0;
	},

	// Called only the first time this primitive is edited
	initEdit: function () {
		// Linked widgets
		if (this.element.hasAttribute("data-input")) {
			var selector = this.element.getAttribute("data-input");

			if (selector) {
				this.editor = $.clone($(selector));

				if (!Wysie.is("formControl", this.editor)) {
					if ($(Wysie.selectors.output, this.editor)) { // has output element?
						// Process it as a wysie instance, so people can use references
						this.editor.setAttribute("data-store", "none");
						new Wysie(this.editor);
					}
					else {
						this.editor = null; // Cannot use this, sorry bro
					}
				}
			}
		}

		if (!this.editor) {
			// No editor provided, use default for element type
			// Find default editor for datatype
			var editor = _.getMatch(this.element, _.editors);

			if (editor.create) {
				$.extend(this, editor, property => property != "create");
			}

			var create = editor.create || editor;
			this.editor = $.create($.type(create) === "function"? create.call(this) : create);
			this.editorValue = this.value;
		}

		this.editor._.events({
			"input": evt => {
				if (this.attribute) {
					this.element.setAttribute(this.attribute, this.editorValue);
				}

				if (this.exposed || !this.attribute) {
					this.update(this.editorValue);
				}
			},
			"focus": evt => {
				this.editor.select && this.editor.select();
			},
			"keyup": evt => {
				if (this.popup && evt.keyCode == 13 || evt.keyCode == 27) {
					if (this.popup.contains(document.activeElement)) {
						this.element.focus();
					}

					evt.stopPropagation();
					this.hidePopup();
				}
			},
			"wysie:propertychange": evt => {
				if (evt.property === "output") {
					evt.stopPropagation();
					$.fire(this.editor, "input");
				}
			}
		});

		if ("placeholder" in this.editor) {
			this.editor.placeholder = "(" + this.label + ")";
		}

		if (!this.exposed) {
			// Copy any data-input-* attributes from the element to the editor
			var dataInput = /^data-input-/i;
			$$(this.element.attributes).forEach(function (attribute) {
				if (dataInput.test(attribute.name)) {
					this.editor.setAttribute(attribute.name.replace(dataInput, ""), attribute.value);
				}
			}, this);

			if (this.attribute) {
				// Set up popup
				this.element.classList.add("using-popup");

				this.popup = this.popup || $.create("div", {
					className: "wysie-popup",
					hidden: true,
					contents: [
						this.label + ":",
						this.editor
					]
				});

				// No point in having a dropdown in a popup
				if (this.editor.matches("select")) {
					this.editor.size = Math.min(10, this.editor.children.length);
				}

				// Toggle popup events & methods
				var hideCallback = evt => {
					if (!this.popup.contains(evt.target) && !this.element.contains(evt.target)) {
						this.hidePopup();
					}
				};

				this.showPopup = function() {
					$.unbind([this.element, this.popup], ".wysie:showpopup");
					this.popup._.after(this.element);

					this.popup._.style({ // TODO what if it doesn’t fit?
						top: this.element.offsetTop + this.element.offsetHeight + "px",
						left: this.element.offsetLeft + "px"
					});

					this.popup._.removeAttribute("hidden"); // trigger transition

					$.events(document, "focus click", hideCallback, true);
				};

				this.hidePopup = function() {
					$.unbind(document, "focus click", hideCallback, true);

					this.popup.setAttribute("hidden", ""); // trigger transition

					setTimeout(() => {
						$.remove(this.popup);
					}, 400); // TODO transition-duration could override this

					$.events(this.element, "focus.wysie:showpopup click.wysie:showpopup", evt => {
						this.showPopup();
					}, true);
				};
			}
		}

		if (!this.popup) {
			this.editor.classList.add("wysie-editor");
		}

		this.initEdit = null;
	},

	edit: function () {
		if (this.editing) {
			return;
		}

		this.element._.unbind(".wysie:preedit");

		if (this.initEdit) {
			this.initEdit();
		}

		if (this.popup) {
			this.showPopup();
		}

		this.savedValue = this.value;

		if (!this.attribute) {
			if (this.editor.parentNode != this.element && !this.exposed) {
				this.editorValue = this.value;
				this.element.textContent = "";

				if (!this.exposed) {
					this.element.appendChild(this.editor);
				}
			}
		}

		this.editing = true;
	}, // edit

	import: function() {
		this.value = this.savedValue = this.templateValue;
	},

	render: function(data) {
		this.value = this.savedValue = data === undefined? this.emptyValue : data;
	},

	find: function(property) {
		if (this.property == property) {
			return this;
		}
	},

	lazy: {
		label: function() {
			return Wysie.readable(this.property);
		},

		emptyValue: function() {
			switch (this.datatype) {
				case "boolean":
					return false;
				case "number":
					return 0;
			}

			return "";
		}
	},

	live: {
		empty: function(value) {
			if (!value || this.attribute && $(Wysie.selectors.property, this.element)) {
				// If it contains other properties, it shouldn’t be hidden
				this.element.classList.remove("empty");
			}
			else {
				this.element.classList.add("empty");
			}

		},
		editing: function (value) {
			this.element.classList[value? "add" : "remove"]("editing");
		}
	},

	static: {
		getMatch: function (element, all) {
			// TODO specificity
			var ret = null;

			for (var selector in all) {
				if (element.matches(selector)) {
					ret = all[selector];
				}
			}

			return ret;
		},

		getValueAttribute: function callee(element) {
			var ret = (callee.cache = callee.cache || new WeakMap()).get(element);

			if (ret === undefined || DISABLE_CACHE) {
				ret = element.getAttribute("data-attribute") || _.getMatch(element, _.attributes);

				// TODO refactor this
				if (ret) {
					if (ret.humanReadable && element._.data.unit instanceof _) {
						element._.data.unit.humanReadable = ret.humanReadable;
					}

					ret = ret.value || ret;
				}

				if (!ret || ret === "null") {
					ret = null;
				}

				callee.cache.set(element, ret);
			}

			return ret;
		},

		getDatatype: function callee (element, attribute) {
			var ret = (callee.cache = callee.cache || new WeakMap()).get(element);

			if (ret === undefined || DISABLE_CACHE) {
				ret = element.getAttribute("datatype");

				if (!ret) {
					for (var selector in _.datatypes) {
						if (element.matches(selector)) {
							ret = _.datatypes[selector][attribute];
						}
					}
				}

				ret = ret || "string";

				callee.cache.set(element, ret);
			}

			return ret;
		},

		getValue: function callee(element, attribute, datatype) {
			var getter = (callee.cache = callee.cache || new WeakMap()).get(element);

			if (!getter || DISABLE_CACHE) {
				attribute = attribute || attribute === null? attribute : _.getValueAttribute(element);
				datatype = datatype || _.getDatatype(element, attribute);

				getter = function() {
					var ret;

					if (attribute in element && _.useProperty(element, attribute)) {
						// Returning properties (if they exist) instead of attributes
						// is needed for dynamic elements such as checkboxes, sliders etc
						ret = element[attribute];
					}
					else if (attribute) {
						ret = element.getAttribute(attribute);
					}
					else {
						ret = element.textContent || null;

					}

					switch (datatype) {
						case "number": return +ret;
						case "boolean": return !!ret;
						default: return ret;
					}
				};

				callee.cache.set(element, getter);
			}

			return getter();
		},

		setValue: function callee(element, value, attribute) {
			if (attribute !== null) {
				attribute = attribute? (attribute.name || attribute) :  _.getValueAttribute(element);
			}

			if (attribute in element && _.useProperty(element, attribute)) {
				// Setting properties (if they exist) instead of attributes
				// is needed for dynamic elements such as checkboxes, sliders etc
				element[attribute] = value;
			}

			// Set attribute anyway, even if we set a property because when
			// they're not in sync it gets really fucking confusing.
			if (attribute) {
				element.setAttribute(attribute, value);
			}
			else {
				element.textContent = value;
			}
		},

		/**
		 *  Set/get a property or an attribute?
		 * @return {Boolean} true to use a property, false to use the attribute
		 */
		useProperty: function(element, attribute) {
			if (["href", "src"].indexOf(attribute) > -1) {
				// URL properties resolve "" as location.href, fucking up emptiness checks
				return false;
			}

			if (element.namespaceURI == "http://www.w3.org/2000/svg") {
				// SVG has a fucked up DOM, do not use these properties
				return false;
			}

			return true;
		}
	}
});

// Define default attributes
_.attributes = {
	"img, video, audio": "src",
	"a, link": "href",
	"select, input, textarea": "value",
	"input[type=checkbox]": "checked",
	"time": {
		value: "datetime",
		humanReadable: function (value) {
			var date = new Date(value);

			if (!value || isNaN(date)) {
				return "(" + this.label + ")";
			}

			// TODO do this properly (account for other datetime datatypes and different formats)
			var months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

			return date.getDate() + " " + months[date.getMonth()] + " " + date.getFullYear();
		}
	},
	"meta": "content"
};

// Basic datatypes per attribute
// Only number, boolean
_.datatypes = {
	"input[type=checkbox]": {
		"checked": "boolean"
	},
	"input[type=range], input[type=number]": {
		"value": "number"
	}
};

_.editors = {
	"*": {"tag": "input"},

	".number": {
		"tag": "input",
		"type": "number"
	},

	".boolean": {
		"tag": "input",
		"type": "checkbox"
	},

	"a, img, video, audio, .url": {
		"tag": "input",
		"type": "url",
		"placeholder": "http://"
	},

	"p, div, .multiline": {
		create: {tag: "textarea"},

		get editorValue () {
			return this.editor && this.editor.value;
		},

		set editorValue (value) {
			if (this.editor) {
				this.editor.value = value ? value.replace(/\r?\n/g, "") : "";
			}
		}
	},

	"time, .date": function() {
		var types = {
			"date": /^[Y\d]{4}-[M\d]{2}-[D\d]{2}$/i,
			"month": /^[Y\d]{4}-[M\d]{2}$/i,
			"time": /^[H\d]{2}:[M\d]{2}/i,
			"week": /[Y\d]{4}-W[W\d]{2}$/i,
			"datetime-local": /^[Y\d]{4}-[M\d]{2}-[D\d]{2} [H\d]{2}:[M\d]{2}/i
		};

		var datetime = this.element.getAttribute("datetime") || "YYYY-MM-DD";

		for (var type in types) {
			if (types[type].test(datetime)) {
				break;
			}
		}

		return $.create("input", {type: type});
	}
};

Stretchy.selectors.filter = ".wysie-editor";

})(Bliss, Bliss.$);