import React from 'react';
import { AppMode, User } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  currentMode: AppMode;
  onNavigate: (mode: AppMode) => void;
  user?: User;
  onLogin: () => void;
  onLogout: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, currentMode, onNavigate, user, onLogin, onLogout }) => {
  return (
    <div className="min-h-screen flex flex-col bg-dark text-gray-100 font-sans">
      <nav className="bg-gray-800 border-b border-gray-700 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center cursor-pointer" onClick={() => onNavigate(AppMode.HOME)}>
              <i className="fa-solid fa-map-location-dot text-primary text-2xl mr-2"></i>
              <span className="font-bold text-xl tracking-tight text-white">GeoGuide<span className="text-accent">AI</span></span>
            </div>
            <div className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-4">
                <button
                  onClick={() => onNavigate(AppMode.HOME)}
                  className={`px-3 py-2 rounded-md text-sm font-medium ${currentMode === AppMode.HOME ? 'bg-primary text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                >
                  Home
                </button>
                <button
                  onClick={() => onNavigate(AppMode.CONSUMER)}
                  className={`px-3 py-2 rounded-md text-sm font-medium ${currentMode === AppMode.CONSUMER ? 'bg-primary text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                >
                  Explore Tours
                </button>
                <button
                  onClick={() => onNavigate(AppMode.CREATOR)}
                  className={`px-3 py-2 rounded-md text-sm font-medium ${currentMode === AppMode.CREATOR ? 'bg-primary text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                >
                  Create Tour
                </button>
              </div>
            </div>
            <div>
              {user ? (
                <div className="flex items-center space-x-3">
                  <span className="text-sm text-gray-300 hidden sm:block">{user.name}</span>
                  <img className="h-8 w-8 rounded-full border border-gray-600" src={user.avatarUrl} alt="" />
                  <button onClick={onLogout} className="text-xs text-gray-400 hover:text-white">
                    <i className="fa-solid fa-sign-out-alt"></i>
                  </button>
                </div>
              ) : (
                <button
                  onClick={onLogin}
                  className="bg-accent hover:bg-amber-600 text-white px-4 py-2 rounded-md text-sm font-medium transition"
                >
                  Login
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      <footer className="bg-gray-900 border-t border-gray-800 py-6">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-500 text-sm">
          &copy; {new Date().getFullYear()} GeoGuide AI. Powered by Gemini.
        </div>
      </footer>
    </div>
  );
};

export default Layout;