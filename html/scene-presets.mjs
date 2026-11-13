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
  broadleaf: { name: "樹木：広葉樹", source: `version 1;

// 丸い葉群を重ねた広葉樹。上は +Y。
sdf trunk(x, y, z) {
  let bend = x - 0.045 * sin(3 * y);
  let radius = 0.105 - 0.035 * y;
  return max(length([bend, z]) - radius, abs(y) - 0.85);
}
sdf branch(x, y, z) {
  // 原点から [0.63, 0.72, 0] への、先細りの枝。
  let t = clamp((x * 0.63 + y * 0.72) / 0.9153, 0, 1);
  return length([x - 0.63 * t, y - 0.72 * t, z]) - mix(0.085, 0.035, t);
}
sdf crown(x, y, z) {
  let a = (length([(x + 0.52) / 0.66, (y + 0.12) / 0.59, z / 0.66]) - 1) * 0.59;
  let b = (length([(x - 0.49) / 0.70, (y + 0.04) / 0.64, (z + 0.08) / 0.63]) - 1) * 0.63;
  let c = (length([x / 0.72, (y - 0.42) / 0.64, (z + 0.14) / 0.66]) - 1) * 0.64;
  let d = (length([(x + 0.08) / 0.78, (y + 0.08) / 0.57, (z - 0.43) / 0.59]) - 1) * 0.57;
  let e = (length([(x + 0.18) / 0.66, y / 0.57, (z + 0.48) / 0.55]) - 1) * 0.55;
  let clusters = min(a, b, c, d, e);
  return clusters + 0.022 * sin(19 * x + 3 * sin(7 * z)) * sin(21 * y) * sin(18 * z);
}

define bark {
  color = "#725039"; secondaryColor = "#98704b"; secondaryRatio = 0.18;
  size = 0.8; thickness = 0.18;
}
scene {
  seed = 31;
  defaults {
    sampling { extent = 1; resolution = 64; }
    splat = bark;
    effect { type = none; }
  }
  lighting {
    ambient = 0.48;
    main { intensity = 0.58; azimuth = -35; elevation = 50; }
    fill { intensity = 0.18; }
  }
  object trunk {
    shape = trunk;
    transform { position = [0, -0.64, 0]; }
  }
  object rightBranch {
    shape = branch;
    transform { position = [0, -0.47, 0]; }
  }
  object leftBranch {
    shape = branch;
    transform { position = [0, -0.35, 0]; rotation = [0, 160, 0]; }
  }
  object frontBranch {
    shape = branch;
    transform { position = [0, -0.22, 0]; rotation = [0, -80, 0]; scale = 0.8; }
  }
  object leaves {
    shape = crown;
    sampling { extent = 1.3; resolution = 80; }
    transform { position = [0, 0.62, 0]; }
    splat {
      color = "#43833c"; secondaryColor = "#8dbb4c"; secondaryRatio = 0.28;
      size = 0.72; thickness = 0.3;
    }
    effect {
      type = fluffy; density = 210; length = 0.065; width = 0.025;
      disorder = 0.7; variation = 0.55; clump = 0.35; clumpSize = 0.13;
    }
  }
}` },
  conifer: { name: "樹木：針葉樹", source: `version 1;

// モミ・スギ風の段状の樹冠。短い毛で針葉を表現します。
sdf trunk(x, y, z) {
  return max(length([x, z]) - (0.085 - 0.025 * y), abs(y) - 1.25);
}
sdf tier(x, y, z) {
  let angle = atan2(z, x);
  let height = clamp((y + 0.44) / 1.16, 0, 1);
  let radius = 0.92 * (1 - height);
  let lobes = 1 + 0.075 * sin(9 * angle + 0.6) + 0.035 * sin(15 * angle);
  let edge = (length([x, z]) - radius * lobes) * 0.78;
  let underside = -y - 0.44 + 0.045 * sin(9 * angle);
  return max(edge, underside, y - 0.72);
}
scene {
  seed = 47;
  defaults {
    sampling { extent = 1.12; resolution = 64; }
    splat {
      color = "#245d46"; secondaryColor = "#528461"; secondaryRatio = 0.22;
      size = 0.75; thickness = 0.22;
    }
    effect {
      type = fur; density = 700; length = 0.045; width = 0.004;
      disorder = 0.45; variation = 0.45; clump = 0.15; clumpSize = 0.12;
    }
  }
  lighting {
    ambient = 0.5;
    main { intensity = 0.55; azimuth = -35; elevation = 50; }
    fill { intensity = 0.2; }
  }
  object trunk {
    shape = trunk;
    sampling { extent = 1.35; resolution = 80; }
    transform { position = [0, -0.22, 0]; }
    splat { color = "#74513a"; secondaryColor = "#a17a50"; secondaryRatio = 0.16; }
    effect { type = none; }
  }
  object lowerBoughs {
    shape = tier;
    transform { position = [0, -0.58, 0]; }
  }
  object middleBoughs {
    shape = tier;
    transform { position = [0, -0.03, 0]; rotation = [0, 27, 0]; scale = 0.83; }
  }
  object upperBoughs {
    shape = tier;
    transform { position = [0, 0.43, 0]; rotation = [0, -17, 0]; scale = 0.65; }
    splat { color = "#2e6c4d"; }
  }
  object topBoughs {
    shape = tier;
    transform { position = [0, 0.82, 0]; rotation = [0, 42, 0]; scale = 0.47; }
    splat { color = "#397753"; }
  }
  object leader {
    shape = tier;
    transform { position = [0, 1.13, 0]; scale = 0.28; }
    splat { color = "#45815a"; }
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
