import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.124/build/three.module.js';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.124/examples/jsm/loaders/FBXLoader.js';

export const player = (() => {
  class Player {
    constructor(params) {
      this.position_ = new THREE.Vector3(0, 0, 0);
      this.velocity_ = 0.0;
      this.params_ = params;
      this.isColliding = false; // Flag to track collision status
      this.bounceCount = 0; // Number of bounces
      this.maxBounces = 4; // Maximum number of bounces
      this.bounceVelocity = 12; // Initial velocity for bounces
      this.gameOver = false; // Flag to track game over state
      this.character = "";

      this.LoadModel_();
      this.InitInput_();
      console.log('Player');
    }

    LoadModel_() {
      const character = localStorage.getItem('character');
      this.character = character;
      const characterPath = character ? character : 'Velociraptor';
      const loader = new FBXLoader();
      loader.setPath('./resources/Dinosaurs/FBX/');

      loader.load(character+'.fbx', (fbx) => {
        // if (character === 'Parasaurolophus' || character === 'Velociraptor')
        //   {
        //     fbx.scale.setScalar(0.0025);
        //   }
        // else {fbx.scale.setScalar(0.00175)}
        let scale = 0.0025;
        if (character === 'Parasaurolophus' || character === 'Velociraptor') {
          scale = 0.00475;
        } 
        else if (character === 'Stegosaurus' || character === 'Triceratops')
          {
              scale = 0.00225;
          }
        else {
          scale = 0.00175;
        }
        fbx.scale.set(scale, scale, scale);
        fbx.quaternion.setFromAxisAngle(
          new THREE.Vector3(0, 1, 0), Math.PI / 2
        );

        this.mesh_ = fbx;
        this.params_.scene.add(this.mesh_);

        fbx.traverse(c => {
          let materials = c.material;
          if (!(c.material instanceof Array)) {
            materials = [c.material];
          }

          for (let m of materials) {
            if (m) {
              console.log("Material:", m);
              m.specular = new THREE.Color(0x000000);
              m.color.offsetHSL(0, 0, 0.25);
            }
          }
          c.castShadow = true;
          c.receiveShadow = true;
        });

        this.mixer_ = new THREE.AnimationMixer(fbx);

        this.actions_ = {};
        for (let i = 0; i < fbx.animations.length; ++i) {
          const clip = fbx.animations[i];
          const action = this.mixer_.clipAction(clip);
          this.actions_[clip.name] = action;
          // Log this.actions_ to the console
          console.log('Animation actions:', clip.name);
          if (clip.name.includes('Run')) {
            action.play();
          }
        }
      });
    }

    InitInput_() {
      this.keys_ = {
        space: false,
      };
      this.oldKeys = { ...this.keys_ };

      document.addEventListener('keydown', (e) => this.OnKeyDown_(e), false);
      document.addEventListener('keyup', (e) => this.OnKeyUp_(e), false);
    }

    OnKeyDown_(event) {
      switch (event.keyCode) {
        case 32:
          this.keys_.space = true;
          break;
      }
    }

    OnKeyUp_(event) {
      switch (event.keyCode) {
        case 32:
          this.keys_.space = false;
          break;
      }
    }

    CheckCollisions_() {
      const colliders = this.params_.world.GetColliders();

      for (let c of colliders) {
        const cur = c.collider;

        const isColliding = cur.containsPoint(this.mesh_.position);

        if (isColliding && !this.isColliding) {
          this.isColliding = true;
          this.bounceCount = 0;
          this.bounceVelocity = 10;
          this.PlayDeathAnimation_();
          return; // Exit if collision detected
        }
      }
    }

    Update(timeElapsed) {
      if (this.gameOver) {
        return;
      }

      if (this.isColliding) {
        if (this.bounceCount < this.maxBounces) {
          this.position_.y += this.bounceVelocity * timeElapsed;
          this.bounceVelocity -= 50 * timeElapsed;

          if (this.position_.y <= 0.3) {
            this.bounceCount++;
            this.position_.y = 0.3;
            this.bounceVelocity = Math.max(12 - this.bounceCount*2, 0);

            if (this.bounceCount >= this.maxBounces) {
              this.isColliding = false;
              this.gameOver = true;
              this.PlayFallAnimation_();
            }
          }
        }
      } else {
        if (this.keys_.space && this.position_.y == 0.0 && !this.isColliding) {
          this.velocity_ = 30;
        }

        const acceleration = -75 * timeElapsed;

        this.position_.y += timeElapsed * (
          this.velocity_ + acceleration * 0.5
        );
        this.position_.y = Math.max(this.position_.y, 0.0);

        this.velocity_ += acceleration;
        this.velocity_ = Math.max(this.velocity_, -100);
      }

      if (this.mesh_) {
        this.mixer_.update(timeElapsed);
        this.mesh_.position.copy(this.position_);
        this.CheckCollisions_();
      }
    }

    PlayFallAnimation_() {
      if (this.character === "Apatosaurus" || this.character === "Trex" || this.character === "Triceratops" || this.character === "Stegosaurus")
        {
          this.mesh_.rotation.x = -Math.PI / 4;
        }
      else
        {
          this.mesh_.rotation.x = Math.PI * 0.5;
        }
        this.mesh_.position.y = 0.5;
    }

    PlayDeathAnimation_() {
      for (let name in this.actions_) {
        if (name.includes('Death')) {
          this.actions_[name].play();
        }
      }
    }
  }

  return {
    Player: Player,
  };
})();
