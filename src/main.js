import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.124/build/three.module.js";

import { player } from "./player.js";
import { world } from "./world.js";
import { background } from "./background.js";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.124/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.124/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.124/examples/jsm/postprocessing/UnrealBloomPass.js";
import {
  Lensflare,
  LensflareElement,
} from "https://cdn.jsdelivr.net/npm/three@0.124/examples/jsm/objects/Lensflare.js";

const _VS = `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const _FS = `
uniform vec3 topColor;
uniform vec3 bottomColor;
uniform float offset;
uniform float exponent;
varying vec3 vWorldPosition;
void main() {
  float h = normalize( vWorldPosition + offset ).y;
  gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max( h , 0.0), exponent ), 0.0 ) ), 1.0 );
}`;

const _PCSS = `
#define LIGHT_WORLD_SIZE 0.05
#define LIGHT_FRUSTUM_WIDTH 3.75
#define LIGHT_SIZE_UV (LIGHT_WORLD_SIZE / LIGHT_FRUSTUM_WIDTH)
#define NEAR_PLANE 1.0

#define NUM_SAMPLES 17
#define NUM_RINGS 11
#define BLOCKER_SEARCH_NUM_SAMPLES NUM_SAMPLES
#define PCF_NUM_SAMPLES NUM_SAMPLES

vec2 poissonDisk[NUM_SAMPLES];

void initPoissonSamples( const in vec2 randomSeed ) {
  float ANGLE_STEP = PI2 * float( NUM_RINGS ) / float( NUM_SAMPLES );
  float INV_NUM_SAMPLES = 1.0 / float( NUM_SAMPLES );

  // jsfiddle that shows sample pattern: https://jsfiddle.net/a16ff1p7/
  float angle = rand( randomSeed ) * PI2;
  float radius = INV_NUM_SAMPLES;
  float radiusStep = radius;

  for( int i = 0; i < NUM_SAMPLES; i ++ ) {
    poissonDisk[i] = vec2( cos( angle ), sin( angle ) ) * pow( radius, 0.75 );
    radius += radiusStep;
    angle += ANGLE_STEP;
  }
}

float penumbraSize( const in float zReceiver, const in float zBlocker ) { // Parallel plane estimation
  return (zReceiver - zBlocker) / zBlocker;
}

float findBlocker( sampler2D shadowMap, const in vec2 uv, const in float zReceiver ) {
  // This uses similar triangles to compute what
  // area of the shadow map we should search
  float searchRadius = LIGHT_SIZE_UV * ( zReceiver - NEAR_PLANE ) / zReceiver;
  float blockerDepthSum = 0.0;
  int numBlockers = 0;

  for( int i = 0; i < BLOCKER_SEARCH_NUM_SAMPLES; i++ ) {
    float shadowMapDepth = unpackRGBAToDepth(texture2D(shadowMap, uv + poissonDisk[i] * searchRadius));
    if ( shadowMapDepth < zReceiver ) {
      blockerDepthSum += shadowMapDepth;
      numBlockers ++;
    }
  }

  if( numBlockers == 0 ) return -1.0;

  return blockerDepthSum / float( numBlockers );
}

float PCF_Filter(sampler2D shadowMap, vec2 uv, float zReceiver, float filterRadius ) {
  float sum = 0.0;
  for( int i = 0; i < PCF_NUM_SAMPLES; i ++ ) {
    float depth = unpackRGBAToDepth( texture2D( shadowMap, uv + poissonDisk[ i ] * filterRadius ) );
    if( zReceiver <= depth ) sum += 1.0;
  }
  for( int i = 0; i < PCF_NUM_SAMPLES; i ++ ) {
    float depth = unpackRGBAToDepth( texture2D( shadowMap, uv + -poissonDisk[ i ].yx * filterRadius ) );
    if( zReceiver <= depth ) sum += 1.0;
  }
  return sum / ( 2.0 * float( PCF_NUM_SAMPLES ) );
}

float PCSS ( sampler2D shadowMap, vec4 coords ) {
  vec2 uv = coords.xy;
  float zReceiver = coords.z; // Assumed to be eye-space z in this code

  initPoissonSamples( uv );
  // STEP 1: blocker search
  float avgBlockerDepth = findBlocker( shadowMap, uv, zReceiver );

  //There are no occluders so early out (this saves filtering)
  if( avgBlockerDepth == -1.0 ) return 1.0;

  // STEP 2: penumbra size
  float penumbraRatio = penumbraSize( zReceiver, avgBlockerDepth );
  float filterRadius = penumbraRatio * LIGHT_SIZE_UV * NEAR_PLANE / zReceiver;

  // STEP 3: filtering
  //return avgBlockerDepth;
  return PCF_Filter( shadowMap, uv, zReceiver, filterRadius );
}
`;

const _PCSSGetShadow = `
return PCSS( shadowMap, shadowCoord );
`;

class BasicWorldDay {
  constructor() {
    this._Initialize();

    this._gameStarted = false;
    document.getElementById("start-button").onclick = (msg) =>
      this._OnStart(msg);
  }

  _OnStart(msg) {
    document.getElementById("game-menu").style.display = "none";
    this._gameStarted = true;
  }

  _Initialize() {
    // overwrite shadowmap code
    let shadowCode = THREE.ShaderChunk.shadowmap_pars_fragment;

    shadowCode = shadowCode.replace(
      "#ifdef USE_SHADOWMAP",
      "#ifdef USE_SHADOWMAP" + _PCSS
    );

    shadowCode = shadowCode.replace(
      "#if defined( SHADOWMAP_TYPE_PCF )",
      _PCSSGetShadow + "#if defined( SHADOWMAP_TYPE_PCF )"
    );

    THREE.ShaderChunk.shadowmap_pars_fragment = shadowCode;
    // renderer

    this.threejs_ = new THREE.WebGLRenderer({
      antialias: true,
    });
    this.threejs_.outputEncoding = THREE.sRGBEncoding;
    this.threejs_.gammaFactor = 2.2;
    // this.threejs_.toneMapping = THREE.ReinhardToneMapping;
    this.threejs_.shadowMap.enabled = true;
    // this.threejs_.shadowMap.type = THREE.PCFSoftShadowMap;
    this.threejs_.setPixelRatio(window.devicePixelRatio);
    this.threejs_.setSize(window.innerWidth, window.innerHeight);

    document.getElementById("container").appendChild(this.threejs_.domElement);

    window.addEventListener(
      "resize",
      () => {
        this.OnWindowResize_();
      },
      false
    );

    const fov = 60;
    const aspect = 1920 / 1080;
    const near = 1.0;
    const far = 20000.0;
    this.camera_ = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.camera_.position.set(-5, 5, 10);
    this.camera_.lookAt(8, 3, 0);

    this.scene_ = new THREE.Scene();
    //Them hieu ung anh sang
    const renderScene = new RenderPass(this.scene_, this.camera_);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.2, // strength
      0.2, // radius
      0.85 // threshold
    );

    this.composer_ = new EffectComposer(this.threejs_);
    this.composer_.addPass(renderScene);
    this.composer_.addPass(bloomPass); //end Them hieu ung anh sang

    let light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(60, 100, 5);
    light.target.position.set(40, 0, 0);
    light.castShadow = true;
    light.shadow.bias = -0.001;
    light.shadow.mapSize.width = 4096;
    light.shadow.mapSize.height = 4096;
    light.shadow.camera.far = 200.0;
    light.shadow.camera.near = 1.0;
    light.shadow.camera.left = 50;
    light.shadow.camera.right = -50;
    light.shadow.camera.top = 50;
    light.shadow.camera.bottom = -50;
    this.scene_.add(light);
    //Them mat troi
    this.light_ = light; // Store the light for later use
    const sunGeometry = new THREE.SphereGeometry(2, 32, 32);
    const sunMaterial = new THREE.MeshStandardMaterial({
      color: 0xffdd44,
      emissive: 0xffdd44,
      emissiveIntensity: 2.0,
    });
    this.sun_ = new THREE.Mesh(sunGeometry, sunMaterial);
    this.sun_.position.copy(light.position); // Position the sun at the light source
    this.sun_.position.set(50, 20, 0); // Position the sun at the light source
    this.scene_.add(this.sun_); //end Them mat troi
    // Create a texture loader
    const textureLoader = new THREE.TextureLoader();

    // Load the lens flare textures
    const textureFlare0 = textureLoader.load(
      "https://threejs.org/examples/textures/lensflare/lensflare0.png"
    );
    const textureFlare3 = textureLoader.load(
      "https://threejs.org/examples/textures/lensflare/lensflare3.png"
    );

    // Create the lens flare and add elements
    const lensflare = new Lensflare();
    lensflare.addElement(new LensflareElement(textureFlare0, 300, 0));
    lensflare.addElement(new LensflareElement(textureFlare3, 60, 0.6));
    lensflare.addElement(new LensflareElement(textureFlare3, 70, 0.7));
    lensflare.addElement(new LensflareElement(textureFlare3, 120, 0.9));
    lensflare.addElement(new LensflareElement(textureFlare3, 70, 1.0));

    // Position the lens flare at the light source (sun position)
    lensflare.position.set(47, 20, 0);
    this.scene_.add(lensflare);

    light = new THREE.HemisphereLight(0x202020, 0x004080, 0.6);
    this.scene_.add(light);

    this.scene_.background = new THREE.Color(0x808080);
    this.scene_.fog = new THREE.FogExp2(0x89b2eb, 0.00125);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20000, 20000, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0xf6f47f,
      })
    );
    ground.castShadow = false;
    ground.receiveShadow = true;
    ground.rotation.x = -Math.PI / 2;
    this.scene_.add(ground);

    const uniforms = {
      topColor: { value: new THREE.Color(0x0077ff) },
      bottomColor: { value: new THREE.Color(0x89b2eb) },
      offset: { value: 33 },
      exponent: { value: 0.6 },
    };
    const skyGeo = new THREE.SphereBufferGeometry(1000, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: _VS,
      fragmentShader: _FS,
      side: THREE.BackSide,
    });
    this.scene_.add(new THREE.Mesh(skyGeo, skyMat));

    this.world_ = new world.WorldManager({ scene: this.scene_ });
    this.player_ = new player.Player({
      scene: this.scene_,
      world: this.world_,
    });
    this.background_ = new background.Background({ scene: this.scene_ });

    this.gameOver_ = false;
    this.previousRAF_ = null;
    this.RAF_();
    this.OnWindowResize_();
  }

  OnWindowResize_() {
    this.camera_.aspect = window.innerWidth / window.innerHeight;
    this.camera_.updateProjectionMatrix();
    this.threejs_.setSize(window.innerWidth, window.innerHeight);
  }

  RAF_() {
    requestAnimationFrame((t) => {
      if (this.previousRAF_ === null) {
        this.previousRAF_ = t;
      }

      this.RAF_();

      this.Step_((t - this.previousRAF_) / 1000.0);
      // this.threejs_.render(this.scene_, this.camera_);
      this.composer_.render(); //Doi renderer
      this.previousRAF_ = t;
    });
  }

  Step_(timeElapsed) {
    if (this.gameOver_ || !this._gameStarted) {
      return;
    }

    this.player_.Update(timeElapsed);
    this.world_.Update(timeElapsed);
    this.background_.Update(timeElapsed);

    if (this.player_.gameOver && !this.gameOver_) {
      this.gameOver_ = true;
      document.getElementById("game-over").classList.toggle("active");
    }
  }
}

class BasicWorldNight {
  constructor() {
    this._Initialize();

    this._gameStarted = false;
    document.getElementById("start-button").onclick = (msg) =>
      this._OnStart(msg);
  }

  _OnStart(msg) {
    document.getElementById("game-menu").style.display = "none";
    this._gameStarted = true;
  }

  _Initialize() {
    // overwrite shadowmap code
    let shadowCode = THREE.ShaderChunk.shadowmap_pars_fragment;

    shadowCode = shadowCode.replace(
      "#ifdef USE_SHADOWMAP",
      "#ifdef USE_SHADOWMAP" + _PCSS
    );

    shadowCode = shadowCode.replace(
      "#if defined( SHADOWMAP_TYPE_PCF )",
      _PCSSGetShadow + "#if defined( SHADOWMAP_TYPE_PCF )"
    );

    THREE.ShaderChunk.shadowmap_pars_fragment = shadowCode;

    // renderer
    this.threejs_ = new THREE.WebGLRenderer({
      antialias: true,
    });
    this.threejs_.outputEncoding = THREE.sRGBEncoding;
    this.threejs_.gammaFactor = 2.2;
    this.threejs_.shadowMap.enabled = true;
    this.threejs_.setPixelRatio(window.devicePixelRatio);
    this.threejs_.setSize(window.innerWidth, window.innerHeight);

    document.getElementById("container").appendChild(this.threejs_.domElement);

    window.addEventListener(
      "resize",
      () => {
        this.OnWindowResize_();
      },
      false
    );

    // const fov = 60;
    // const aspect = 1920 / 1080;
    // const near = 1.0;
    // const far = 5000.0;
    // this.camera_ = new THREE.PerspectiveCamera(fov, aspect, near, far);
    // this.camera_.position.set(-5, 5, 10);
    // this.camera_.lookAt(8, 3, 0);

    // this.scene_ = new THREE.Scene();
    const fov = 60;
    const aspect = 1920 / 1080;
    const near = 1.0;
    const far = 20000.0;
    this.camera_ = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.camera_.position.set(-5, 5, 10);
    this.camera_.lookAt(8, 3, 0);

    this.scene_ = new THREE.Scene();

    // let light = new THREE.DirectionalLight(0xffffff, 1.0);
    // light.position.set(60, 100, 10);
    // light.target.position.set(40, 0, 0);
    // light.castShadow = true;
    // light.shadow.bias = -0.001;
    // light.shadow.mapSize.width = 4096;
    // light.shadow.mapSize.height = 4096;
    // light.shadow.camera.far = 200.0;
    // // light.shadow.camera.near = 1.0;
    // light.shadow.camera.left = 50;
    // light.shadow.camera.right = -50;
    // light.shadow.camera.top = 50;
    // light.shadow.camera.bottom = -50;
    // light.color.setHex(0x6699ff); // Đặt màu của ánh sáng thành màu xanh nhạt
    // light.intensity = 0.6; // Đặt độ sáng của ánh sáng
    // this.scene_.add(light);
    // Adjust lighting for night
    let light = new THREE.DirectionalLight(0xffffff, 0.9);
    light.position.set(60, 100, 5);
    light.target.position.set(40, 0, 0);
    light.castShadow = true;
    light.shadow.bias = -0.001;
    light.shadow.mapSize.width = 4096;
    light.shadow.mapSize.height = 4096;
    light.shadow.camera.far = 200.0;
    light.shadow.camera.near = 1.0;
    light.shadow.camera.left = 50;
    light.shadow.camera.right = -50;
    light.shadow.camera.top = 50;
    light.shadow.camera.bottom = -50;
    this.scene_.add(light);
    this.light_ = light;

    // Sun (reduced intensity)
    const sunGeometry = new THREE.SphereGeometry(2, 32, 32);
    const sunMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.5, // reduced intensity for night
    });
    this.sun_ = new THREE.Mesh(sunGeometry, sunMaterial);
    this.sun_.position.copy(light.position);
    this.sun_.position.set(50, 20, 0);
    // this.scene_.add(this.sun_);

    light = new THREE.HemisphereLight(0x202020, 0x004080, 0.2);
    this.scene_.add(light);

    // this.scene_.background = new THREE.Color(0x808080);
    // this.scene_.fog = new THREE.FogExp2(0x89b2eb, 0.00125);
    this.scene_.background = new THREE.Color(0x000000); // Đặt màu nền là màu đen
    this.scene_.fog = new THREE.FogExp2(0x000022, 0.001); // Đặt sương mù là màu xanh đậm

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20000, 20000, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0x000022,
      })
    );
    ground.castShadow = false;
    ground.receiveShadow = true;
    ground.rotation.x = -Math.PI / 2;
    this.scene_.add(ground);
    // Create starfield
    function createStars() {
      const starGeometry = new THREE.BufferGeometry();
      const starMaterial = new THREE.PointsMaterial({
        color: 0xaaaaaa,
        size: 1.0,
      });

      const starVertices = [];
      for (let i = 0; i < 10000; i++) {
        const x = Math.random() * 2000 - 1000;
        const y = Math.random() * 2000 - 1000;
        const z = Math.random() * 2000 - 1000;
        starVertices.push(x, y, z);
      }

      starGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(starVertices, 3)
      );

      const stars = new THREE.Points(starGeometry, starMaterial);
      return stars;
    }

    this.scene_.add(createStars());

    // const uniforms = {
    //   topColor: { value: new THREE.Color(0x0077ff) },
    //   bottomColor: { value: new THREE.Color(0x89b2eb) },
    //   offset: { value: 33 },
    //   exponent: { value: 0.6 },
    // };
    const uniforms = {
      topColor: { value: new THREE.Color(0x000000) },
      bottomColor: { value: new THREE.Color(0x000033) },
      offset: { value: 33 },
      exponent: { value: 0.6 },
    };
    // uniforms.topColor.value = new THREE.Color(0x000022); // Đặt màu của topColor là màu xanh đậm
    // uniforms.bottomColor.value = new THREE.Color(0x000000); // Đặt màu của bottomColor là màu đen

    const skyGeo = new THREE.SphereBufferGeometry(1000, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: _VS,
      fragmentShader: _FS,
      side: THREE.BackSide,
    });
    this.scene_.add(new THREE.Mesh(skyGeo, skyMat));
    // Post-processing for bloom effect
    const renderScene = new RenderPass(this.scene_, this.camera_);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.2, // strength
      0.2, // radius
      0.85 // threshold
    );

    this.composer_ = new EffectComposer(this.threejs_);
    this.composer_.addPass(renderScene);
    this.composer_.addPass(bloomPass);

    this.world_ = new world.WorldManager({ scene: this.scene_ });
    this.player_ = new player.Player({
      scene: this.scene_,
      world: this.world_,
    });
    this.background_ = new background.Background({ scene: this.scene_ });

    this.gameOver_ = false;
    this.previousRAF_ = null;
    this.RAF_();
    this.OnWindowResize_();
  }

  OnWindowResize_() {
    this.camera_.aspect = window.innerWidth / window.innerHeight;
    this.camera_.updateProjectionMatrix();
    this.threejs_.setSize(window.innerWidth, window.innerHeight);
  }

  RAF_() {
    requestAnimationFrame((t) => {
      if (this.previousRAF_ === null) {
        this.previousRAF_ = t;
      }

      this.RAF_();

      this.Step_((t - this.previousRAF_) / 1000.0);
      // this.threejs_.render(this.scene_, this.camera_);
      this.composer_.render();
      this.previousRAF_ = t;
    });
  }

  Step_(timeElapsed) {
    if (this.gameOver_ || !this._gameStarted) {
      return;
    }

    this.player_.Update(timeElapsed);
    this.world_.Update(timeElapsed);
    this.background_.Update(timeElapsed);

    if (this.player_.gameOver && !this.gameOver_) {
      this.gameOver_ = true;
      document.getElementById("game-over").classList.toggle("active");
    }
  }
}

let _APP = null;

// window.addEventListener('DOMContentLoaded', () => {
//   const mode = localStorage.getItem('mode');
//   console.log("mode: ", mode);

//   _APP = new BasicWorldDay();
// });

document.getElementById("setmode-button").onclick = (msg) => {
  const mode = localStorage.getItem("mode");

  if (mode !== "day") {
    _APP = new BasicWorldNight();
  } else {
    _APP = new BasicWorldDay();
  }
};
