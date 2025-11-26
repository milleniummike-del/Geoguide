import React, { useState, useEffect, useRef } from 'react';
import Layout from './components/Layout';
import { AppMode, User } from './types';
import { MOCK_USER, GOOGLE_CLIENT_ID, ENABLE_MOCK_LOGIN } from './constants';
import { storageService } from './services/storageService';

// Pages
import HomePage from './pages/HomePage';
import CreatorPage from './pages/CreatorPage';
import ConsumerPage from './pages/ConsumerPage';

declare global {
  interface Window {
    google: any;
  }
}

// Helper to decode JWT from Google
const parseJwt = (token: string) => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
};

const App: React.FC = () => {
  const [currentMode, setCurrentMode] = useState<AppMode>(AppMode.HOME);
  const [user, setUser] = useState<User | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initialize storage service
    storageService.initialize().then(() => setLoading(false));
  }, []);

  // Initialize Google Sign-In
  useEffect(() => {
    if (window.google && GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.includes('YOUR_CLIENT_ID')) {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse
      });
    }
  }, []);

  // Render button when in Creator mode and not logged in
  useEffect(() => {
    if (currentMode === AppMode.CREATOR && !user && googleButtonRef.current && window.google) {
       // Check if client ID is set
       if (GOOGLE_CLIENT_ID.includes('YOUR_CLIENT_ID')) {
           return; // Don't try to render if ID is invalid
       }

       window.google.accounts.id.renderButton(
         googleButtonRef.current,
         { theme: "filled_black", size: "large", width: "250", text: "continue_with" } 
       );
    }
  }, [currentMode, user]);

  const handleCredentialResponse = (response: any) => {
    const responsePayload = parseJwt(response.credential);
    if (responsePayload) {
        const newUser: User = {
            id: responsePayload.sub,
            name: responsePayload.name,
            email: responsePayload.email,
            avatarUrl: responsePayload.picture
        };
        setUser(newUser);
    }
  };

  const handleLogout = () => {
    setUser(undefined);
    if (window.google) {
        window.google.accounts.id.disableAutoSelect();
    }
    if (currentMode === AppMode.CREATOR) {
      setCurrentMode(AppMode.HOME);
    }
  };

  const renderContent = () => {
    switch (currentMode) {
      case AppMode.CREATOR:
        return user ? (
          <CreatorPage user={user} />
        ) : (
          <div className="flex flex-col items-center justify-center h-96 text-center">
            <i className="fa-solid fa-lock text-6xl text-gray-600 mb-4"></i>
            <h2 className="text-2xl font-bold mb-2">Creator Access Required</h2>
            <p className="text-gray-400 mb-6 max-w-md">
                Please log in with your Google account to create and manage tours.
            </p>
            
            <div className="flex flex-col items-center space-y-4">
                {/* Google Sign In Button Container */}
                <div ref={googleButtonRef} className="min-h-[40px]"></div>

                {/* Dev Login Option */}
                {ENABLE_MOCK_LOGIN && (
                    <button 
                        onClick={() => setUser(MOCK_USER)}
                        className="px-4 py-2 bg-gray-800 border border-gray-600 hover:bg-gray-700 rounded text-sm text-gray-300 transition flex items-center"
                    >
                        <i className="fa-solid fa-code mr-2"></i> Dev Mode: Mock Login
                    </button>
                )}
            </div>
            
            {/* Configuration Warning (only if ID is default) */}
            {GOOGLE_CLIENT_ID.includes('YOUR_CLIENT_ID') && (
                <div className="mt-8 bg-red-900/50 border border-red-500 p-4 rounded-lg max-w-md text-left">
                    <p className="text-red-200 font-bold mb-1"><i className="fa-solid fa-triangle-exclamation mr-2"></i> Configuration Needed</p>
                    <p className="text-sm text-red-100 mb-2">
                        To enable Real Google Login, you must create a Client ID in the Google Cloud Console.
                    </p>
                    <p className="text-xs text-gray-400 font-mono bg-black p-2 rounded">
                        Update GOOGLE_CLIENT_ID in constants.ts
                    </p>
                </div>
            )}
          </div>
        );
      case AppMode.CONSUMER:
        return <ConsumerPage />;
      case AppMode.HOME:
      default:
        return <HomePage onNavigate={setCurrentMode} />;
    }
  };

  if (loading) {
    return <div className="h-screen flex items-center justify-center bg-dark text-white">Loading GeoGuide...</div>;
  }

  return (
    <Layout
      currentMode={currentMode}
      onNavigate={setCurrentMode}
      user={user}
      onLogin={() => setCurrentMode(AppMode.CREATOR)} // Redirect to creator to trigger login view
      onLogout={handleLogout}
    >
      {renderContent()}
    </Layout>
  );
};

export default App;