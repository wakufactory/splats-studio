import { basicSetup, EditorView } from "codemirror";
import { EditorState, Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { indentService, indentUnit, StreamLanguage } from "@codemirror/language";
import { completeFromList } from "@codemirror/autocomplete";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";

const keywords = ["version", "let", "sdf", "return", "scene", "defaults", "object",
  "sampling", "splat", "effect", "lighting", "transform"];
const properties = ["shape", "seed", "resolution", "extent", "size", "thickness", "color",
  "secondaryColor", "secondaryRatio", "type", "density", "length", "width", "disorder", "variation",
  "clump", "clumpSize", "base", "ambient", "main", "azimuth", "elevation", "fill", "position", "rotation", "scale"];
const functions = ["abs", "sqrt", "sin", "cos", "tan", "floor", "ceil", "round", "sign", "exp", "log",
  "pow", "atan2", "min", "max", "length", "clamp", "mix", "sphere", "torus", "box", "union", "intersection", "subtract", "smoothUnion"];
const complete = completeFromList([
  ...keywords.map(label => ({ label, type: "keyword" })),
  ...properties.map(label => ({ label, type: "property" })),
  ...functions.map(label => ({ label, type: "function" })),
]);
const language = StreamLanguage.define({
  startState: () => ({ comment: false }),
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } }, autocomplete: complete },
  token(stream, state) {
    if (state.comment) {
      if (stream.skipTo("*/")) { stream.match("*/"); state.comment = false; }
      else stream.skipToEnd();
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (stream.match("/*")) { state.comment = true; return "comment"; }
    if (stream.match(/^"(?:\\.|[^"\\])*"?/)) return "string";
    if (stream.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)) return "number";
    if (stream.match(/^[a-z_]\w*/i)) {
      const word = stream.current();
      if (keywords.includes(word)) return "keyword";
      if (functions.includes(word)) return "function";
      if (["pi", "true", "false", "none", "fur", "fluffy"].includes(word)) return "atom";
      return properties.includes(word) ? "propertyName" : "variableName";
    }
    if (stream.eat(/[+*/%<>=!&|?:-]/)) return "operator";
    stream.next();
    return null;
  },
});

export function mountSourceEditor(textarea, onGenerate) {
  const extensions = [basicSetup, vscodeDark, language, indentUnit.of("  "),
    indentService.of((context, pos) => {
      const line = context.lineAt(pos);
      if (!line.from) return 0;
      const previous = context.lineAt(line.from - 1);
      return Math.max(0, context.lineIndent(previous.from)
        + (/\{\s*(?:\/\/.*)?$/.test(previous.text) ? 2 : 0)
        - (/^\s*}/.test(line.text) ? 2 : 0));
    }),
    Prec.high(keymap.of([
      { key: "Mod-Enter", run() { onGenerate(); return true; } },
      { key: "Ctrl-Enter", run() { onGenerate(); return true; } },
      indentWithTab,
    ])),
    EditorView.theme({
      "&": { height: "100%", minWidth: "0", fontSize: "13px" },
      "&.cm-focused": { outline: "1px solid #a6dfc5", outlineOffset: "-1px" },
      ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.65", overflow: "auto", overscrollBehavior: "contain" },
      ".cm-content": { padding: "12px 0" },
    }),
    EditorView.contentAttributes.of({ "aria-label": textarea.getAttribute("aria-label"), spellcheck: "false", autocapitalize: "off" }),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      textarea.value = update.state.doc.toString();
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }),
  ];
  const view = new EditorView({ parent: textarea.parentElement,
    state: EditorState.create({ doc: textarea.value, extensions }) });
  textarea.parentElement.classList.add("cm-mounted");
  return {
    setValue(value) {
      textarea.value = value;
      view.setState(EditorState.create({ doc: value, extensions }));
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    },
  };
}

globalThis.SplatSourceEditor = { mount: mountSourceEditor };
