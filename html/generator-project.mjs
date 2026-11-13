// Defaults use the same units as the generation worker (secondaryRatio: 0–1).
export const defaultSettings = Object.freeze({
  extent: 1.5, resolution: 64, size: 0.72, thickness: 0.15,
  color: "#71debb", secondaryColor: "#de7194", secondaryRatio: 0, seed: 1,
  ambientIntensity: 0.37, mainIntensity: 0.61, mainAzimuth: 46.15,
  mainElevation: 58.2, fillIntensity: 0.23,
});
const ranges = {
  extent: [0.1, 20], resolution: [16, 144], size: [0.3, 1.5], thickness: [0.05, 0.8],
  secondaryRatio: [0, 1], seed: [0, 1_000_000], ambientIntensity: [0, 1],
  mainIntensity: [0, 2], mainAzimuth: [-180, 180], mainElevation: [-90, 90], fillIntensity: [0, 2],
};
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function validateProject(project) {
  if (!isRecord(project) || project.format !== "sdf-splat-studio" || project.version !== 1) {
    throw new Error("SDF Splat Studio の対応する JSON（format / version: 1）が必要です。");
  }
  if (typeof project.source !== "string" || project.source.length > 100_000) {
    throw new Error("source は10万文字以内の DSL コードにしてください。");
  }
  if (!isRecord(project.defaults)) throw new Error("defaults にデフォルト設定が必要です。");
  const defaults = {};
  for (const key of Object.keys(defaultSettings)) {
    const value = project.defaults[key];
    if (key === "color" || key === "secondaryColor") {
      if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
        throw new Error(`defaults.${key} は #RRGGBB 形式で指定してください。`);
      }
    } else {
      const [min, max] = ranges[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max
          || (["resolution", "seed"].includes(key) && !Number.isInteger(value))) {
        throw new Error(`defaults.${key} は ${min}〜${max} の${["resolution", "seed"].includes(key) ? "整数" : "数値"}にしてください。`);
      }
    }
    defaults[key] = value;
  }
  if (project.name !== undefined && (typeof project.name !== "string" || project.name.length > 255)) {
    throw new Error("name は255文字以内の保存名にしてください。");
  }
  return { format: "sdf-splat-studio", version: 1, source: project.source, defaults, name: project.name ?? "" };
}

export function parseProject(text) {
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new Error("JSON の構文を確認してください。"); }
  return validateProject(data);
}

export function serializeProject(source, defaults, name = "") {
  return JSON.stringify(validateProject({ format: "sdf-splat-studio", version: 1, source, defaults, name }), null, 2) + "\n";
}

export function projectFilename(name, fallback = "sdf-scene", extension = "json") {
  const stem = name.trim().replace(/\.(json|ply|sog)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "");
  return `${stem || fallback}.${extension}`;
}

export function readSettings(byId) {
  return Object.fromEntries(Object.keys(defaultSettings).map(key => {
    const input = byId(key);
    return [key, input.type === "color" ? input.value
      : input.valueAsNumber / (key === "secondaryRatio" ? 100 : 1)];
  }));
}

export function applySettings(settings, byId) {
  for (const [key, value] of Object.entries(settings)) {
    byId(key).value = key === "secondaryRatio" ? value * 100 : value;
  }
}
