const single = (body, name = "surface") => `version 1;

sdf shape(x, y, z) {
${body}
}

scene {
  // 省略した設定には画面のデフォルト値を使います。
  object ${name} {
    shape = shape;
  }
}`;

export const scenePresets = {
  torus: { name: "トーラス", source: single("  return torus(x, y, z, 0.88, 0.34);") },
  sphere: { name: "球", source: single("  return sphere(x, y, z, 1);") },
  box: { name: "角丸ボックス", source: single("  return box(x, y, z, 0.76, 0.55, 0.76) - 0.18;") },
  cut: { name: "差分：貫通穴", source: single(`  let body = sphere(x, y, z, 1.16);
  let holes = min(length([x, y]), length([y, z]), length([z, x])) - 0.40;
  return subtract(body, holes);`) },
  multi: { name: "複数SDFと毛・房", source: `version 1;

let radius = 0.55;

sdf ball(x, y, z) {
  return sphere(x, y, z, radius);
}

sdf ring(x, y, z) {
  return torus(x, y, z, 0.55, 0.16);
}

scene {
  object fuzzyBall {
    shape = ball;
    transform { position = [-0.8, 0, 0]; }
    splat { color = "#e9bc82"; }
    effect {
      type = fur;
      density = 450;
      length = 0.14;
      width = 0.008;
    }
  }

  object smoothRing {
    shape = ring;
    transform { position = [0.8, 0, 0]; rotation = [25, 0, 0]; }
    splat { color = "#71bbde"; }
  }

  object fluffyBall {
    shape = ball;
    transform { position = [0, 1.1, 0]; scale = 0.6; }
    splat { color = "#de7194"; secondaryRatio = 0.2; }
    effect {
      type = fluffy;
      density = 120;
      length = 0.16;
      width = 0.045;
    }
  }
}` },
};
