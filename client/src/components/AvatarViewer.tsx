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
    talking: string;
    happy: string;
    greeting: string;
  };
}

// A-pose to T-pose offset angles (in radians)
// RPM avatars have arms at ~30-45 degrees down from horizontal
const APOSE_TO_TPOSE_OFFSET = THREE.MathUtils.degToRad(40);

// Helper to find SkinnedMesh using traverse (handles deep hierarchies)
function findSkinnedMesh(object: THREE.Object3D): THREE.SkinnedMesh | null {
  let result: THREE.SkinnedMesh | null = null;
  object.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh && !result) {
      result = child;
    }
  });
  return result;
}

// Find a bone by name in a skeleton
function findBoneByName(skeleton: THREE.Skeleton, name: string): THREE.Bone | null {
  return skeleton.bones.find(b => b.name === name) || null;
}

// Build bone name mapping from Mixamo to RPM
// Example: "mixamorigHips" -> "Hips"
function buildBoneNameMap(
  sourceSkeleton: THREE.Skeleton | null,
  targetSkeleton: THREE.Skeleton,
  animationClip?: THREE.AnimationClip
): Record<string, string> {
  const map: Record<string, string> = {};
  const unmatchedBones: string[] = [];
  const matchedBones: string[] = [];

  // Create a set of target bone names for quick lookup
  const targetBoneNames = new Set(targetSkeleton.bones.map(b => b.name));

  console.log('========== BONE NAME MAPPING DEBUG ==========');
  console.log('[Retarget] Target (RPM) bone count:', targetSkeleton.bones.length);
  console.log('[Retarget] Target (RPM) bone names:', targetSkeleton.bones.map(b => b.name));

  // Get source bone names from skeleton or animation clip
  let sourceBoneNames: string[] = [];

  if (sourceSkeleton) {
    console.log('[Retarget] Source (Mixamo) bone count:', sourceSkeleton.bones.length);
    console.log('[Retarget] Source (Mixamo) bone names:', sourceSkeleton.bones.map(b => b.name));
    sourceBoneNames = sourceSkeleton.bones.map(b => b.name);
  } else if (animationClip) {
    // Extract bone names from animation tracks
    const boneNameSet = new Set<string>();
    for (const track of animationClip.tracks) {
      const dotIndex = track.name.lastIndexOf('.');
      if (dotIndex !== -1) {
        boneNameSet.add(track.name.substring(0, dotIndex));
      }
    }
    sourceBoneNames = Array.from(boneNameSet);
    console.log('[Retarget] Source bone names (from animation):', sourceBoneNames);
  }

  for (const boneName of sourceBoneNames) {
    // Remove 'mixamorig' or 'mixamorig:' prefix
    let mappedName = boneName.replace(/^mixamorig:?/, '');

    if (targetBoneNames.has(mappedName)) {
      map[boneName] = mappedName;
      matchedBones.push(`"${boneName}" -> "${mappedName}"`);
    } else {
      unmatchedBones.push(`"${boneName}" -> "${mappedName}" (NOT FOUND)`);
    }
  }

  console.log('[Retarget] ✅ MATCHED BONES (' + matchedBones.length + '):');
  matchedBones.forEach(b => console.log('   ' + b));

  console.log('[Retarget] ❌ UNMATCHED BONES (' + unmatchedBones.length + '):');
  unmatchedBones.forEach(b => console.log('   ' + b));

  // Special check for hand bones
  const handBoneCheck = ['LeftHand', 'RightHand', 'LeftForeArm', 'RightForeArm'];
  console.log('[Retarget] 🖐️ HAND BONE CHECK:');
  handBoneCheck.forEach(name => {
    const inTarget = targetBoneNames.has(name);
    const mappedSource = Object.entries(map).find(([_, v]) => v === name);
    console.log(`   ${name}: Target=${inTarget ? '✅' : '❌'}, Mapped=${mappedSource ? `✅ from "${mappedSource[0]}"` : '❌ NOT MAPPED'}`);
  });

  console.log('==============================================');

  return map;
}

// Apply A-pose to T-pose correction to UpperArm bones
function applyTPoseCorrection(skeleton: THREE.Skeleton): Map<string, THREE.Quaternion> {
  const originalRotations = new Map<string, THREE.Quaternion>();

  const armBones = [
    { name: 'LeftUpperArm', angle: APOSE_TO_TPOSE_OFFSET },
    { name: 'RightUpperArm', angle: -APOSE_TO_TPOSE_OFFSET },
    { name: 'LeftShoulder', angle: APOSE_TO_TPOSE_OFFSET * 0.3 },
    { name: 'RightShoulder', angle: -APOSE_TO_TPOSE_OFFSET * 0.3 },
  ];

  console.log('[T-Pose] Applying T-pose correction to RPM skeleton...');

  for (const { name, angle } of armBones) {
    const bone = findBoneByName(skeleton, name);
    if (bone) {
      originalRotations.set(name, bone.quaternion.clone());
      const correctionQuat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        angle
      );
      bone.quaternion.premultiply(correctionQuat);
      console.log(`[T-Pose] ✅ Rotated ${name} by ${THREE.MathUtils.radToDeg(angle).toFixed(1)}° around Z-axis`);
    } else {
      console.warn(`[T-Pose] ❌ Bone "${name}" not found in skeleton`);
    }
  }

  skeleton.bones[0]?.updateMatrixWorld(true);
  return originalRotations;
}

// Restore original A-pose rotations
function restoreAPose(skeleton: THREE.Skeleton, originalRotations: Map<string, THREE.Quaternion>): void {
  console.log('[T-Pose] Restoring original A-pose...');

  for (const [name, quat] of originalRotations) {
    const bone = findBoneByName(skeleton, name);
    if (bone) {
      bone.quaternion.copy(quat);
    }
  }

  skeleton.bones[0]?.updateMatrixWorld(true);
}

// Create hand correction quaternions
// Mixamo and RPM have different bone roll for hands
// We need to test different axis combinations
function createHandCorrectionQuaternions(): { left: THREE.Quaternion, right: THREE.Quaternion } {
  // Try X-axis 180° rotation (flips the palm direction)
  const xFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

  // Try Y-axis 180° rotation (flips the hand front/back)
  const yFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

  // Try Z-axis 180° rotation (flips the wrist roll)
  const zFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);

  // Combined correction: often hand issues require X or Y axis flip, not just Z
  // For left hand: flip around local X axis
  // For right hand: flip around local X axis (mirrored)
  const leftHandCorrection = xFlip.clone();
  const rightHandCorrection = xFlip.clone();

  console.log('[Hand] Left hand correction: X-axis 180° rotation');
  console.log('[Hand] Right hand correction: X-axis 180° rotation');

  return {
    left: leftHandCorrection,
    right: rightHandCorrection
  };
}

// Retarget animation clip with bone name mapping and pose corrections
function retargetAnimationClip(
  clip: THREE.AnimationClip,
  boneNameMap: Record<string, string>,
  animationName: string
): THREE.AnimationClip {
  const newTracks: THREE.KeyframeTrack[] = [];
  const processedBones: string[] = [];
  const skippedBones: string[] = [];
  const handCorrectedBones: string[] = [];

  console.log(`========== RETARGETING: ${animationName} ==========`);
  console.log(`[Retarget] Original clip: "${clip.name}", duration: ${clip.duration.toFixed(2)}s, tracks: ${clip.tracks.length}`);

  // Get hand correction quaternions
  const handCorrections = createHandCorrectionQuaternions();

  // Bones that need special hand correction
  const handBoneCorrections: Record<string, THREE.Quaternion> = {
    'LeftHand': handCorrections.left,
    'RightHand': handCorrections.right,
    'LeftForeArm': new THREE.Quaternion(), // Identity for now, can add if needed
    'RightForeArm': new THREE.Quaternion(),
  };

  for (const track of clip.tracks) {
    try {
      // Extract bone name from track name
      const dotIndex = track.name.lastIndexOf('.');
      if (dotIndex === -1) {
        console.warn(`[Retarget] Invalid track name format: "${track.name}"`);
        continue;
      }

      const boneName = track.name.substring(0, dotIndex);
      const property = track.name.substring(dotIndex + 1);
      const mappedBoneName = boneNameMap[boneName];

      if (!mappedBoneName) {
        if (!skippedBones.includes(boneName)) {
          skippedBones.push(boneName);
        }
        continue;
      }

      // Skip position and scale tracks to avoid distortion
      if (property === 'position' || property === 'scale') {
        continue;
      }

      const newTrackName = `${mappedBoneName}.${property}`;

      // Check if this bone needs hand correction
      const handCorrection = handBoneCorrections[mappedBoneName];
      const needsHandCorrection = handCorrection && !handCorrection.equals(new THREE.Quaternion()) && property === 'quaternion';

      if (needsHandCorrection) {
        // Apply hand correction
        const values = track.values as Float32Array;
        const correctedValues = new Float32Array(values.length);

        for (let i = 0; i < values.length; i += 4) {
          const originalQuat = new THREE.Quaternion(
            values[i], values[i + 1], values[i + 2], values[i + 3]
          );
          // Apply correction: first the original, then the correction
          // correctedQuat = originalQuat * handCorrection (post-multiply for local space)
          const correctedQuat = originalQuat.clone().multiply(handCorrection);
          correctedValues[i] = correctedQuat.x;
          correctedValues[i + 1] = correctedQuat.y;
          correctedValues[i + 2] = correctedQuat.z;
          correctedValues[i + 3] = correctedQuat.w;
        }

        const newTrack = new THREE.QuaternionKeyframeTrack(
          newTrackName,
          track.times as Float32Array,
          correctedValues
        );
        newTracks.push(newTrack);
        handCorrectedBones.push(mappedBoneName);

        if (!processedBones.includes(mappedBoneName)) {
          processedBones.push(mappedBoneName);
        }
      } else {
        // Standard track - just rename
        const TrackConstructor = track.constructor as new (
          name: string,
          times: Float32Array,
          values: Float32Array
        ) => THREE.KeyframeTrack;

        const newTrack = new TrackConstructor(
          newTrackName,
          track.times as Float32Array,
          track.values as Float32Array
        );
        newTracks.push(newTrack);

        if (!processedBones.includes(mappedBoneName)) {
          processedBones.push(mappedBoneName);
        }
      }
    } catch (err) {
      console.error(`[Retarget] Error processing track "${track.name}":`, err);
    }
  }

  console.log(`[Retarget] ✅ Processed bones (${processedBones.length}):`, processedBones);
  console.log(`[Retarget] 🖐️ Hand-corrected bones:`, handCorrectedBones);
  console.log(`[Retarget] ❌ Skipped unmapped bones (${skippedBones.length}):`, skippedBones);
  console.log(`[Retarget] Output tracks: ${newTracks.length}`);

  if (newTracks.length === 0) {
    console.error(`[Retarget] ⚠️ WARNING: No tracks created for ${animationName}! Check bone mapping.`);
  }

  const retargetedClip = new THREE.AnimationClip(clip.name || animationName, clip.duration, newTracks);
  console.log(`[Retarget] Retargeted clip created: "${retargetedClip.name}", tracks: ${retargetedClip.tracks.length}`);
  console.log('==============================================');

  return retargetedClip;
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
      console.log('[Avatar] Loading avatar from:', avatarUrl);

      loader.load(
        avatarUrl,
        (gltf: any) => {
          console.log('[Avatar] ✅ Avatar loaded successfully');
          const model = gltf.scene;
          model.scale.set(3, 3, 3);
          model.position.y = -2.5;
          scene.add(model);

          // Find target skeleton using traverse
          const targetSkinnedMesh = findSkinnedMesh(model);
          const targetSkeleton = targetSkinnedMesh?.skeleton;

          if (!targetSkeleton) {
            console.error('[Retarget] ❌ Could not find skeleton in target model');
            setError('Failed to find skeleton in avatar model');
            setIsLoading(false);
            return;
          }

          console.log('[Retarget] ✅ Found target skeleton with', targetSkeleton.bones.length, 'bones');

          // Apply T-pose correction
          const originalRotations = applyTPoseCorrection(targetSkeleton);

          // Setup animation mixer
          const mixer = new THREE.AnimationMixer(model);
          mixerRef.current = mixer;

          // Load animations
          const animationLoader = new FBXLoader();
          let loadedAnimations = 0;
          const totalAnimations = 6;

          // Cache bone name map
          let boneNameMap: Record<string, string> | null = null;

          const onAnimationLoaded = (name: string, fbxScene: THREE.Group) => {
            try {
              console.log(`[Animation] ========== LOADING: ${name} ==========`);

              const animation = fbxScene.animations[0];
              if (!animation) {
                console.error(`[Animation] ❌ No animation found in FBX for: ${name}`);
                loadedAnimations++;
                checkAllLoaded();
                return;
              }

              console.log(`[Animation] Found clip: "${animation.name}", duration: ${animation.duration.toFixed(2)}s, tracks: ${animation.tracks.length}`);

              // Find source skeleton from FBX
              const sourceSkinnedMesh = findSkinnedMesh(fbxScene);
              const sourceSkeleton = sourceSkinnedMesh?.skeleton;

              // Build bone name map (only once, from first animation)
              if (!boneNameMap) {
                boneNameMap = buildBoneNameMap(sourceSkeleton, targetSkeleton, animation);
              }

              // Retarget the animation clip
              const retargetedClip = retargetAnimationClip(animation, boneNameMap, name);

              if (retargetedClip.tracks.length === 0) {
                console.error(`[Animation] ❌ Retargeted clip for "${name}" has no tracks!`);
              } else {
                const action = mixer.clipAction(retargetedClip);
                actionsRef.current[name] = action;
                console.log(`[Animation] ✅ Action created for: ${name}`);
              }

            } catch (err) {
              console.error(`[Animation] ❌ Error processing animation ${name}:`, err);
            }

            loadedAnimations++;
            checkAllLoaded();
          };

          const checkAllLoaded = () => {
            console.log(`[Animation] Progress: ${loadedAnimations}/${totalAnimations}`);

            if (loadedAnimations === totalAnimations) {
              console.log('[Animation] ✅ All animations loaded. Available actions:', Object.keys(actionsRef.current));

              // Restore original A-pose
              restoreAPose(targetSkeleton, originalRotations);

              // Start default animation
              if (actionsRef.current['walking']) {
                currentActionRef.current = actionsRef.current['walking'];
                currentActionRef.current.play();
                console.log('[Animation] ✅ Started walking animation');
              } else {
                const available = Object.keys(actionsRef.current);
                if (available.length > 0) {
                  currentActionRef.current = actionsRef.current[available[0]];
                  currentActionRef.current.play();
                  console.log(`[Animation] Started fallback animation: ${available[0]}`);
                } else {
                  console.error('[Animation] ❌ No animations available!');
                }
              }
              setIsLoading(false);
            }
          };

          const onAnimationError = (name: string, err: unknown) => {
            console.error(`[Animation] ❌ Failed to load ${name}:`, err);
            loadedAnimations++;
            checkAllLoaded();
          };

          // Load each animation with error handling
          console.log('[Animation] Starting to load 6 animations...');

          animationLoader.load(
            animationUrls.walking,
            (fbx) => onAnimationLoaded('walking', fbx),
            undefined,
            (err) => onAnimationError('walking', err)
          );

          animationLoader.load(
            animationUrls.sitting,
            (fbx) => onAnimationLoaded('sitting', fbx),
            undefined,
            (err) => onAnimationError('sitting', err)
          );

          animationLoader.load(
            animationUrls.standing_up,
            (fbx) => onAnimationLoaded('standing_up', fbx),
            undefined,
            (err) => onAnimationError('standing_up', err)
          );

          animationLoader.load(
            animationUrls.talking,
            (fbx) => onAnimationLoaded('talking', fbx),
            undefined,
            (err) => onAnimationError('talking', err)
          );

          animationLoader.load(
            animationUrls.happy,
            (fbx) => onAnimationLoaded('happy', fbx),
            undefined,
            (err) => onAnimationError('happy', err)
          );

          animationLoader.load(
            animationUrls.greeting,
            (fbx) => onAnimationLoaded('greeting', fbx),
            undefined,
            (err) => onAnimationError('greeting', err)
          );

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
          console.error('[Avatar] ❌ Error loading avatar:', error);
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
    console.log(`[UI] Button clicked: ${animationName}`);

    if (!mixerRef.current) {
      console.error('[UI] ❌ Mixer not initialized');
      return;
    }

    // Stop current animation
    if (currentActionRef.current) {
      currentActionRef.current.stop();
      console.log('[UI] Stopped current animation');
    }

    // Play new animation
    if (actionsRef.current[animationName]) {
      currentActionRef.current = actionsRef.current[animationName];
      currentActionRef.current.reset();
      currentActionRef.current.play();
      console.log(`[UI] ✅ Playing animation: ${animationName}`);
    } else {
      console.error(`[UI] ❌ Animation "${animationName}" not found. Available:`, Object.keys(actionsRef.current));
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
        <Button
          onClick={() => playAnimation('talking')}
          variant="outline"
        >
          Talking
        </Button>
        <Button
          onClick={() => playAnimation('happy')}
          variant="outline"
        >
          Happy
        </Button>
        <Button
          onClick={() => playAnimation('greeting')}
          variant="outline"
        >
          Greeting
        </Button>
      </div>
    </div>
  );
}
