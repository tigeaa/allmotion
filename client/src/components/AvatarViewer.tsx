import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader, FBXLoader } from 'three-stdlib';
import { Button } from '@/components/ui/button';

interface AvatarViewerProps {
  avatarUrl: string;
  animationUrls: {
    walking: string;
    sitting: string;
    standing_up: string;
  };
}

// Retarget animation from Mixamo bone names to RPM bone names
function retargetAnimation(clip: THREE.AnimationClip): THREE.AnimationClip {
  const newTracks: THREE.KeyframeTrack[] = [];

  for (const track of clip.tracks) {
    // Determine target property
    // We only want to retarget rotations (quaternions) to avoid position scaling issues
    // causing the avatar to fly away or distort
    if (track.name.endsWith('.position') || track.name.endsWith('.scale')) {
      continue;
    }

    // Convert Mixamo bone names to RPM format
    // Example: "mixamorigHips.quaternion" -> "Hips.quaternion"
    const newName = track.name.replace(/^mixamorig/, '');

    // Clone the track with the new name
    const TrackConstructor = track.constructor as new (
      name: string,
      times: Float32Array,
      values: Float32Array
    ) => THREE.KeyframeTrack;

    const newTrack = new TrackConstructor(
      newName,
      track.times as Float32Array,
      track.values as Float32Array
    );

    newTracks.push(newTrack);
  }

  return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
}

export default function AvatarViewer({ avatarUrl, animationUrls }: AvatarViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{ [key: string]: THREE.AnimationAction }>({});
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      // Scene setup
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf0f0f0);
      sceneRef.current = scene;

      // Camera setup
      const camera = new THREE.PerspectiveCamera(
        75,
        containerRef.current.clientWidth / containerRef.current.clientHeight,
        0.1,
        1000
      );
      camera.position.z = 5;

      // Renderer setup
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      containerRef.current.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
      directionalLight.position.set(5, 10, 7);
      scene.add(directionalLight);

      // Load avatar model (GLB format)
      const loader = new GLTFLoader();
      loader.load(
        avatarUrl,
        (gltf: any) => {
          const model = gltf.scene;
          model.scale.set(3, 3, 3);
          // Adjust model position to center it
          model.position.y = -1.0;
          scene.add(model);

          // Setup animation mixer
          const mixer = new THREE.AnimationMixer(model);
          mixerRef.current = mixer;

          // Load animations
          const animationLoader = new FBXLoader();
          let loadedAnimations = 0;
          const totalAnimations = 3;

          const onAnimationLoaded = (name: string, fbxScene: THREE.Group) => {
            const animation = fbxScene.animations[0];
            if (animation) {
              const retargetedClip = retargetAnimation(animation);
              const action = mixer.clipAction(retargetedClip);
              actionsRef.current[name] = action;
              loadedAnimations++;

              if (loadedAnimations === totalAnimations) {
                // All animations loaded
                if (actionsRef.current['walking']) {
                  currentActionRef.current = actionsRef.current['walking'];
                  currentActionRef.current.play();
                }
                setIsLoading(false);
              }
            }
          };

          // Load each animation
          animationLoader.load(animationUrls.walking, (fbx: THREE.Group) => {
            onAnimationLoaded('walking', fbx);
          });

          animationLoader.load(animationUrls.sitting, (fbx: THREE.Group) => {
            onAnimationLoaded('sitting', fbx);
          });

          animationLoader.load(animationUrls.standing_up, (fbx: THREE.Group) => {
            onAnimationLoaded('standing_up', fbx);
          });

          // Animation loop
          const clock = new THREE.Clock();
          const animate = () => {
            requestAnimationFrame(animate);
            const delta = clock.getDelta();
            if (mixer) mixer.update(delta);
            renderer.render(scene, camera);
          };
          animate();

          // Handle window resize
          const handleResize = () => {
            if (!containerRef.current) return;
            const width = containerRef.current.clientWidth;
            const height = containerRef.current.clientHeight;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
          };

          window.addEventListener('resize', handleResize);

          return () => {
            window.removeEventListener('resize', handleResize);
          };
        },
        undefined,
        (error: unknown) => {
          console.error('Error loading avatar:', error);
          setError('Failed to load avatar model');
          setIsLoading(false);
        }
      );

      return () => {
        if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
          containerRef.current.removeChild(renderer.domElement);
        }
      };
    } catch (err) {
      console.error('Error initializing viewer:', err);
      setError('Failed to initialize 3D viewer');
      setIsLoading(false);
    }
  }, [avatarUrl, animationUrls]);

  const playAnimation = (animationName: string) => {
    if (!mixerRef.current) return;

    // Stop current animation
    if (currentActionRef.current) {
      currentActionRef.current.stop();
    }

    // Play new animation
    if (actionsRef.current[animationName]) {
      currentActionRef.current = actionsRef.current[animationName];
      currentActionRef.current.reset();
      currentActionRef.current.play();
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div
        ref={containerRef}
        className="flex-1 relative bg-gray-100 rounded-lg overflow-hidden"
        style={{ minHeight: '500px' }}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="text-white text-lg">Loading...</div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="text-white text-lg text-center">{error}</div>
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-2 justify-center">
        <Button
          onClick={() => playAnimation('walking')}
          variant="default"
        >
          Walking
        </Button>
        <Button
          onClick={() => playAnimation('sitting')}
          variant="outline"
        >
          Sitting
        </Button>
        <Button
          onClick={() => playAnimation('standing_up')}
          variant="outline"
        >
          Standing Up
        </Button>
      </div>
    </div>
  );
}
