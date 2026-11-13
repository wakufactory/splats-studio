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
  teddy: { name: "テディベア", source: `version 1;

// 座ったテディベア。顔の正面は +Z、上は +Y。
// 楕円体は軸ごとに座標を割り、最短半径で距離を近似します。
sdf body(x, y, z) {
  return (length([x / 0.63, y / 0.74, z / 0.44]) - 1) * 0.44;
}
sdf head(x, y, z) {
  return (length([x / 0.58, y / 0.53, z / 0.47]) - 1) * 0.47;
}
sdf ear(x, y, z) {
  return (length([x / 0.24, y / 0.25, z / 0.15]) - 1) * 0.15;
}
sdf innerEar(x, y, z) {
  return (length([x / 0.145, y / 0.155, z / 0.045]) - 1) * 0.045;
}
sdf arm(x, y, z) {
  return (length([x / 0.24, y / 0.46, z / 0.25]) - 1) * 0.24;
}
sdf foot(x, y, z) {
  return (length([x / 0.34, y / 0.30, z / 0.43]) - 1) * 0.30;
}
sdf footPad(x, y, z) {
  return (length([x / 0.21, y / 0.20, z / 0.055]) - 1) * 0.055;
}
sdf belly(x, y, z) {
  return (length([x / 0.37, y / 0.44, z / 0.07]) - 1) * 0.07;
}
sdf muzzle(x, y, z) {
  return (length([x / 0.34, y / 0.23, z / 0.145]) - 1) * 0.145;
}
sdf eye(x, y, z) { return sphere(x, y, z, 0.062); }
sdf glint(x, y, z) { return sphere(x, y, z, 0.014); }
sdf nose(x, y, z) {
  return (length([x / 0.105, y / 0.075, z / 0.055]) - 1) * 0.055;
}
sdf mouthStem(x, y, z) {
  return box(x, y, z, 0.006, 0.04, 0.006) - 0.005;
}
sdf smile(x, y, z) {
  let arc = length([length([x, y]) - 0.095, z]) - 0.011;
  return max(arc, y);
}
sdf bowLoop(x, y, z) {
  return (length([x / 0.135, y / 0.075, z / 0.045]) - 1) * 0.045;
}
sdf bowKnot(x, y, z) { return sphere(x, y, z, 0.055); }

// 配色と毛を共通化。部品ごとの差分だけobject側で上書きします。
define bearCoat {
  size = 0.75; thickness = 0.18;
  color = "#a87042"; secondaryColor = "#c28c55"; secondaryRatio = 0.13;
}
define creamCoat { color = "#e4bf91"; secondaryRatio = 0; }
define eyeCoat creamCoat { color = "#211713"; }
define glintCoat creamCoat { color = "#fff5dd"; }
define mouthCoat creamCoat { color = "#523225"; }
define bowCoat creamCoat { color = "#a93443"; }

define bearFur {
  type = fur; density = 1800; length = 0.032; width = 0.006;
  disorder = 0.17; variation = 0.3; clump = 0.1; clumpSize = 0.15;
}
define patchFur bearFur { density = 1000; length = 0.02; width = 0.004; }
define smoothSurface { type = none; }

scene {
  seed = 16;
  defaults {
    sampling { extent = 0.9; resolution = 64; }
    splat = bearCoat;
    effect = bearFur;
  }
  lighting {
    ambient = 0.5;
    main { intensity = 0.5; azimuth = -25; elevation = 45; }
    fill { intensity = 0.15; }
  }

  object body {
    shape = body;
    transform { position = [0, -0.32, 0]; }
  }
  object head {
    shape = head;
    sampling { extent = 0.7; }
    transform { position = [0, 0.63, 0.05]; }
  }
  object leftEar {
    shape = ear;
    sampling { extent = 0.33; resolution = 32; }
    transform { position = [-0.46, 1.04, 0.015]; rotation = [0, 0, 20]; }
  }
  object rightEar {
    shape = ear;
    sampling { extent = 0.33; resolution = 32; }
    transform { position = [0.46, 1.04, 0.015]; rotation = [0, 0, -20]; }
  }
  object leftInnerEar {
    shape = innerEar;
    sampling { extent = 0.2; resolution = 32; }
    transform { position = [-0.48, 1.055, 0.153]; rotation = [0, 0, 20]; }
    splat = creamCoat;
    effect = patchFur;
  }
  object rightInnerEar {
    shape = innerEar;
    sampling { extent = 0.2; resolution = 32; }
    transform { position = [0.48, 1.055, 0.153]; rotation = [0, 0, -20]; }
    splat = creamCoat;
    effect = patchFur;
  }
  object leftArm {
    shape = arm;
    sampling { extent = 0.6; resolution = 48; }
    transform { position = [-0.66, -0.34, 0.055]; rotation = [0, 0, -20]; }
  }
  object rightArm {
    shape = arm;
    sampling { extent = 0.6; resolution = 48; }
    transform { position = [0.66, -0.34, 0.055]; rotation = [0, 0, 20]; }
  }
  object leftFoot {
    shape = foot;
    sampling { extent = 0.55; resolution = 48; }
    transform { position = [-0.43, -0.94, 0.30]; rotation = [0, -12, 0]; }
  }
  object rightFoot {
    shape = foot;
    sampling { extent = 0.55; resolution = 48; }
    transform { position = [0.43, -0.94, 0.30]; rotation = [0, 12, 0]; }
  }
  object leftFootPad {
    shape = footPad;
    sampling { extent = 0.27; resolution = 32; }
    transform { position = [-0.49, -0.93, 0.69]; rotation = [0, -12, 0]; }
    splat = creamCoat;
    effect = patchFur;
  }
  object rightFootPad {
    shape = footPad;
    sampling { extent = 0.27; resolution = 32; }
    transform { position = [0.49, -0.93, 0.69]; rotation = [0, 12, 0]; }
    splat = creamCoat;
    effect = patchFur;
  }
  object bellyPatch {
    shape = belly;
    sampling { extent = 0.52; resolution = 48; }
    transform { position = [0, -0.36, 0.405]; }
    splat = creamCoat;
    effect patchFur { length = 0.025; }
  }
  object muzzle {
    shape = muzzle;
    sampling { extent = 0.42; resolution = 48; }
    transform { position = [0, 0.46, 0.47]; }
    splat creamCoat { color = "#edcfaa"; }
    effect = patchFur;
  }

  // 目・鼻・口は滑らかな表面。小さな部品は探索範囲も絞ります。
  object leftEye {
    shape = eye;
    sampling { extent = 0.1; resolution = 24; }
    transform { position = [-0.22, 0.73, 0.478]; }
    splat = eyeCoat;
    effect = smoothSurface;
  }
  object rightEye {
    shape = eye;
    sampling { extent = 0.1; resolution = 24; }
    transform { position = [0.22, 0.73, 0.478]; }
    splat = eyeCoat;
    effect = smoothSurface;
  }
  object leftEyeGlint {
    shape = glint;
    sampling { extent = 0.1; resolution = 48; }
    transform { position = [-0.235, 0.75, 0.532]; }
    splat = glintCoat;
    effect = smoothSurface;
  }
  object rightEyeGlint {
    shape = glint;
    sampling { extent = 0.1; resolution = 48; }
    transform { position = [0.205, 0.75, 0.532]; }
    splat = glintCoat;
    effect = smoothSurface;
  }
  object nose {
    shape = nose;
    sampling { extent = 0.14; resolution = 32; }
    transform { position = [0, 0.53, 0.606]; }
    splat mouthCoat { color = "#42251c"; }
    effect = smoothSurface;
  }
  object mouthStem {
    shape = mouthStem;
    sampling { extent = 0.1; resolution = 48; }
    transform { position = [0, 0.442, 0.613]; }
    splat = mouthCoat;
    effect = smoothSurface;
  }
  object smile {
    shape = smile;
    sampling { extent = 0.13; resolution = 48; }
    transform { position = [0, 0.415, 0.61]; }
    splat = mouthCoat;
    effect = smoothSurface;
  }

  object leftBow {
    shape = bowLoop;
    sampling { extent = 0.18; resolution = 32; }
    transform { position = [-0.115, 0.11, 0.48]; rotation = [0, 0, -25]; }
    splat = bowCoat;
    effect = smoothSurface;
  }
  object rightBow {
    shape = bowLoop;
    sampling { extent = 0.18; resolution = 32; }
    transform { position = [0.115, 0.11, 0.48]; rotation = [0, 0, 25]; }
    splat = bowCoat;
    effect = smoothSurface;
  }
  object bowKnot {
    shape = bowKnot;
    sampling { extent = 0.1; resolution = 24; }
    transform { position = [0, 0.11, 0.495]; }
    splat bowCoat { color = "#cb5160"; }
    effect = smoothSurface;
  }
}` },
};
