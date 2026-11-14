# Scene DSL — チャット用リファレンス

[HTMLリファレンス](html/dsl.html)の構文・関数・設定・記述例をMarkdown化した仕様です。DSLを変更するときは両方を同期してください。

ジェネレーターの「複数SDFと毛・房」プリセットを選ぶと、複数objectの例を編集できます。

SDFは負が内部、0が表面、正が外部です。Y軸が上です。設定値の優先順位は、画面のデフォルト → sceneの共通設定 → objectの個別設定です。エフェクトの初期値はなしです。

```text
version 1;

let radius = 0.6;

sdf ball(x, y, z) {
  return length([x, y, z]) - radius;
}

sdf ring(x, y, z) {
  return torus(x, y, z, 0.7, 0.2);
}

scene {
  // 省略すれば画面の乱数シードを使います。
  seed = 123;

  defaults {
    sampling { extent = 1.5; resolution = 64; }
    splat { size = 0.72; thickness = 0.15; }
  }

  lighting {
    ambient = 0.37;
    main { intensity = 0.61; azimuth = 46; elevation = 58; }
    fill { intensity = 0.23; }
  }

  object fuzzyBall {
    shape = ball;
    transform { position = [-0.9, 0, 0]; }
    splat { color = "#e9bc82"; }
    effect {
      type = fur;
      density = 700;
      length = 0.16;
      width = 0.012;
      disorder = 0.35;
      variation = 0.4;
      clump = 0.3;
      clumpSize = 0.25;
      base = true;
    }
  }

  object smoothRing {
    shape = ring;
    transform { position = [0.9, 0, 0]; rotation = [30, 0, 0]; scale = 0.8; }
    splat { color = "#71bbde"; secondaryColor = "#ffffff"; secondaryRatio = 0.2; }
  }
}
```

## 定義と数式

`let 名前 = 式;` で定数を定義します。定数からは先に定義した定数を参照できます。SDF内では引数とローカルのlet変数を使い、最後にreturnで距離を返します。SDF同士は定義順に関係なく呼べます。再帰、ループ、JavaScriptのプロパティ参照や外部APIは使えません。旧形式の `function sdf` は使えません。

数値、文字列（ダブルクォート）、配列、true/false、pi、四則演算、剰余%、べき乗**、比較、&&、||、!、条件式 `条件 ? 値 : 値` が使えます。ベクトルは配列で表し、成分ごとの計算はスカラーの式で記述します。文末にセミコロンが必要です。コメントは `//` と `/* ... */` です。

| 関数 | 内容 |
| --- | --- |
| `abs, sqrt, sin, cos, tan, floor, ceil, round, sign, exp, log` | 引数1個。三角関数はラジアン。 |
| `min, max` | 引数2個以上。 |
| `pow(a,b), atan2(y,x)` | べき乗、角度。 |
| `length([x,y,z])` | 配列の長さではなくベクトルの大きさ。 |
| `clamp(v,min,max), mix(a,b,t)` | 範囲制限、線形補間。 |
| `sphere(x,y,z,r)` | 原点中心の球。 |
| `box(x,y,z,hx,hy,hz)` | 原点中心。hx/hy/hzは各軸の半幅。 |
| `torus(x,y,z,major,minor)` | XZ平面のリング。中心円半径と管の半径。 |
| `union(a,b,...), intersection(a,b,...), subtract(a,b), smoothUnion(a,b,k)` | SDFの合成。smoothUnionのkは融合幅。k ≤ 0は通常のunion。 |

## defineで設定を共通化

トップレベルの `define 名前 { ... }` で設定ブロックを定義します。`splat = 名前;` で参照し、`splat 名前 { ... }` で個別の項目を上書きできます。effect、sampling、lighting、transformも同じ書き方です。

```text
define coat { color = "#e4bf91"; secondaryRatio = 0; }
define shortFur { type = fur; density = 1000; length = 0.02; width = 0.004; }
define longFur shortFur { length = 0.05; }

sdf ball(x, y, z) { return sphere(x, y, z, 0.6); }
scene {
  object body {
    shape = ball;
    splat = coat;
    effect = shortFur;
  }
  object head {
    shape = ball;
    transform { position = [0, 0.9, 0]; scale = 0.7; }
    splat coat { color = "#edcfaa"; }
    effect = longFur;
  }
}
```

`define 派生名 元の名前 { ... }` で定義を継承でき、入れ子のブロックも項目ごとに上書きします。`define 別名 = 名前;` で別名も付けられます。複数の設定をまとめ、sceneのdefaultsに適用することもできます。

```text
define bearStyle {
  splat = coat;
  effect = shortFur;
}
// scene内:
// defaults = bearStyle;
// または defaults bearStyle { splat { size = 0.8; } }
```

優先順位は、画面のデフォルト → scene.defaults（参照先 → 上書き）→ object（参照先 → 上書き）です。defineの記述順は自由です。値の式にはトップレベルのlet定数を使えます。define名は定数・SDFとは別の名前空間です。同名のdefine、未定義参照、循環参照は行・列付きのエラーになります。設定名・値は使うブロックに合わせて検証します。defineはversion 1で利用できます。

## 設定の一覧

`defaults` と各object内で `sampling`、`splat`、`effect`、`lighting` を指定できます。未指定の項目を1項目ずつ継承します。scene直下のlightingよりdefaults内のlightingを優先します。typeのnone/fur/fluffyは引用符なしでも指定できます。

| ブロック | 項目（範囲） |
| --- | --- |
| sampling | extent: 0.1〜20、resolution: 16〜144の整数 |
| splat | size: 0.3〜1.5、thickness: 0.05〜0.8、color/secondaryColor: "#rrggbb"、secondaryRatio: 0〜1（割合） |
| effect | type: none/fur/fluffy、density: 0〜4000、length: 0.01〜0.6、width: 0.001〜0.15、disorder/variation/clump: 0〜1、clumpSize: 0.03〜1、base: true/false |
| lighting | ambient: 0〜1、main { intensity: 0〜2、azimuth: −180〜180、elevation: −90〜90 }、fill { intensity: 0〜2 } |
| transform（objectのみ） | position: [x,y,z]、rotation: [x,y,z]（度、Euler XYZ）、scale: 正の数値（一様拡大） |

## 表面エフェクトの詳細仕様

`effect { ... }` はobjectまたはscene.defaults内に記述します。未指定の項目は、左ペイン下部の「表面エフェクト（デフォルト）」→ scene.defaults → objectの順に項目ごとに継承します。下表はUIの初期値です。`effect = 定義名;` や `effect 定義名 { ... }` でも指定できます。値の範囲は両端を含み、数値は小数も指定できます。

| パラメータ | 既定値 | 範囲・指定値 | 意味 |
| --- | --- | --- | --- |
| `type` | `none` | `none / fur / fluffy` | 下地のみ / 毛・起毛 / モコモコ。引用符なし、または文字列で指定。 |
| `density` | 700 | 0〜4000 | ローカル座標の表面積1あたりのおおよその毛・房の数。splat数ではありません。 |
| `length` | 0.16 | 0.01〜0.6 | 毛・房の長さの基準値。SDFと同じローカル単位。 |
| `width` | 0.012 | 0.001〜0.15 | 太さの基準値（ガウスの標準偏差）。見える直径ではありません。 |
| `disorder` | 0.35 | 0〜1 | 毛・房ごとのランダムな傾きの強さ。 |
| `variation` | 0.4 | 0〜1 | 長さ・太さのランダムな個体差の強さ。 |
| `clump` | 0.3 | 0〜1 | 近くの毛・房に共通の傾きを与える強さ。 |
| `clumpSize` | 0.25 | 0.03〜1 | 共通の傾きを作る空間パターンの大きさ。SDFと同じローカル単位。 |
| `base` | `true` | `true / false` | 下地の表面を残すか。noneの場合はこの値によらず下地を生成。 |

### 記述例

```text
version 1;
sdf ball(x, y, z) { return sphere(x, y, z, 1); }
scene {
  seed = 123;
  defaults {
    effect { type = fur; density = 700; length = 0.16; width = 0.012; }
  }
  object coat {
    shape = ball;
    seed = 456;
    effect {
      disorder = 0.35;
      variation = 0.4;
      clump = 0.3;
      clumpSize = 0.25;
      base = true;
    }
  }
}
```

次の例はobject内に記述します。未指定の項目はscene.defaults、そこでも未指定なら画面のデフォルト設定を使います。

```text
// 短毛
effect { type = fur; density = 1000; length = 0.10; width = 0.006; disorder = 0.15; clump = 0.15; }
// 長めの毛
effect { type = fur; density = 700; length = 0.25; width = 0.012; disorder = 0.35; clump = 0.5; }
// ボア・モコモコ
effect { type = fluffy; density = 120; length = 0.16; width = 0.045; disorder = 0.35; clump = 0.3; }
```

### 密度・下地・生成数

セル幅を `step = 2 × sampling.extent / sampling.resolution`、単位法線を `[nx, ny, nz]` とすると、表面セルごとの毛・房の期待数は `density × step² / (abs(nx) + abs(ny) + abs(nz))` です。整数部分を生成し、小数部分を確率としてもう1本追加します。根元は接平面内でランダムにずらしてSDF表面へ再投影します。分割数とは独立した密度を目指しますが、高曲率や粗い分割では均一にならず、本数も概算です。

下地のsplat数をB、生成された毛・房の数をHとすると、`fur` は `(base ? B : 0) + 3 × H`、`fluffy` は `(base ? B : 0) + H`、`none` は常にBです。表面積Aから `H ≈ density × A` と見積もれます。scene全体で下地を含めて50万splatが上限です。

`density = 0;` は毛・房を生成しません。fur/fluffyで `base = false;` を併用し、出力が空になるとエラーになります。密度が低く、確率的に毛・房が1つも生えない場合も同様です。noneではdensityやbaseの値によらず下地だけを生成しますが、各パラメータの範囲検証は行います。

### 長さ・太さ・方向の作用

個々の毛・房の長さLは `length × (1 + rL × variation × 0.8)`、太さWは `width × (1 + rW × variation × 0.6)` で決めます。rLとrWは独立した−1〜1の一様乱数です。variation=0で個体差をなくし、variation=1では長さが基準の0.2〜1.8倍、太さが0.4〜1.6倍になります。

furは根元から先端に向けて3個のsplatを並べます。各区間の中心を表す `t = 1/6, 1/2, 5/6` に対し、横方向の標準偏差は `W × (1 − 0.65 × t)`、長軸方向は `L / 3 × 0.55` です。fluffyは1房を1個の楕円体とし、横方向の標準偏差はW、長軸方向は `L × 0.5` です。lengthは配置の基準であり、Gaussianのぼけを含む見える全長とは一致しません。

disorderは毛・房ごとに独立したランダムな傾き、clumpは位置とシードから求めた連続的な正弦波パターンを接平面へ投影した傾きです。clumpSizeを大きくすると共通の傾きが変化する空間的な間隔が広がります。毛束の直径や毛同士の結合距離を直接指定する値ではなく、物理シミュレーションは行いません。disorderとclumpを両方0にすると法線方向へ伸びます。variation=0だけでは方向の乱れは消えません。

### 座標・乱数・色・保存

length、width、clumpSizeとdensityはtransform前のローカル座標で適用します。その後、下地と毛・房をまとめて一様拡大・回転・移動します。scaleをs倍にしても本数は変わらず、長さ・太さ・毛束パターンはs倍、配置後の面積あたりの密度は1/s²倍になります。splat.sizeとsplat.thicknessは下地の大きさを調整し、毛・房のlength/widthを置き換えるものではありません。

乱数は `seed = 整数;`（0〜1000000）で指定します。seedはeffectの項目ではなくsceneまたはobject直下に置きます。objectで省略すると共通シードとobject名から決定します。同じDSL・画面のデフォルト設定・シードなら配置を再現でき、object名・形状・分割数を変えると配置も変わります。

色は下地と毛・房を含む各splatで、splat.colorまたはsplat.secondaryColorをsecondaryRatioの確率で選びます。furの3区間も個別に選色します。毛・房には根元側を暗くする明暗を付け、配置後の表面法線で照明を焼き付けます。設定は「スプラットを生成」で反映され、PLY / SOGにも大きさ・向き・色を保存します。Gaussianの端がぼけるため、輪郭や毛先は柔らかく見えます。

## 生成と配置

各objectは独立に生成して結合します。重なった内側の表面も残ります。形状として融合したい場合は、SDF内でunionなどを使い、1つのobjectとして生成してください。融合後のsplat・effect設定はそのobjectの1組を使います。

samplingの探索範囲はローカル座標の各軸[-extent,+extent]です。毛の長さ・太さと密度もローカル座標で計算し、表面と毛をまとめて拡大・回転・移動します。size/thicknessはセル幅に対する比率です。照明は配置後の法線を使って色に焼き付けます。

sceneとobjectの直下で `seed = 整数;`（0〜1000000）を指定できます。objectで省略した場合は、共通シードとobject名から決めます。objectを追加・並べ替えしても既存objectの配置は変わりません。object名、分割数や形状を変更すると配置も変わります。

scene全体で50万splat、生成時間は30秒が上限です。失敗・中止した場合は前回の結果を保持します。未知の設定名や範囲外の値は行・列付きで表示します。
