import AvatarViewer from '@/components/AvatarViewer';

/**
 * ReadyPlayerMe Avatar Animation Viewer
 * Displays a 3D avatar with three different animations: walking, sitting, and standing up
 */
export default function Home() {
  const avatarUrl = 'https://models.readyplayer.me/693f7c2478f65986ccfb842d.glb';
  
  const animationUrls = {
    walking: '/animations/walking.fbx',
    sitting: '/animations/sitting.fbx',
    standing_up: '/animations/standing_up.fbx',
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-3xl font-bold text-slate-900">
            ReadyPlayerMe Avatar Animation Viewer
          </h1>
          <p className="text-slate-600 mt-2">
            Explore different animations for your 3D avatar
          </p>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <AvatarViewer 
            avatarUrl={avatarUrl}
            animationUrls={animationUrls}
          />
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center text-slate-600">
          <p>
            Powered by{' '}
            <a 
              href="https://readyplayer.me" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 font-semibold"
            >
              ReadyPlayerMe
            </a>
            {' '}and{' '}
            <a 
              href="https://threejs.org" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 font-semibold"
            >
              Three.js
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
