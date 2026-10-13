import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setApiActor, type User } from '../api';
import { useToast } from './ToastContext';
import { auth } from '../firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, onIdTokenChanged, signOut } from 'firebase/auth';

interface AuthContextType {
  user: User | null;
  isLoggedIn: boolean;
  logout: () => void;
  signup: (userData: Partial<User> & { password?: string, email: string }) => Promise<User>;
  login: (email: string, password: string) => Promise<User>;
  googleSignIn: (role?: 'Donor' | 'Patient' | 'Hospital' | 'Blood Bank') => Promise<User>;
  refreshUser: () => Promise<void>;
  updateUserContext: (updateData: any) => Promise<void>;
  usersList: User[];
  reloadUsersList: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [usersList, setUsersList] = useState<User[]>([]);
  const { showToast } = useToast();

  const reloadUsersList = useCallback(async () => {
    try {
      const list = await api.getUsers();
      setUsersList(list);
      
      // Keep logged in user object updated
      if (user) {
        const freshUser = list.find((u) => u.id === user.id);
        if (freshUser) {
          setUser(freshUser);
          localStorage.setItem('lifelink_user', JSON.stringify(freshUser));
        } else {
          setUser(null);
          localStorage.removeItem('lifelink_user');
        }
      }
    } catch (err: any) {
      console.error("Failed to load users list:", err.message);
    }
  }, [user]);

  // Keep Firebase token in sync with API client
  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const token = await firebaseUser.getIdToken();
        setApiActor(token);
      } else {
        setApiActor(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Load user from localStorage on mount.
  useEffect(() => {
    const savedUser = localStorage.getItem('lifelink_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        localStorage.removeItem('lifelink_user');
      }
    }
    api.getUsers().then(setUsersList).catch(console.error);
  }, []);

  const login = async (email: string, password: string): Promise<User> => {
    try {
      const fbCred = await signInWithEmailAndPassword(auth, email, password);
      const token = await fbCred.user.getIdToken();
      setApiActor(token);

      // Fetch our SQLite user record
      const list = await api.getUsers();
      const loggedUser = list.find(u => u.id === fbCred.user.uid);
      if (!loggedUser) throw new Error("User record not found in database.");

      setUser(loggedUser);
      localStorage.setItem('lifelink_user', JSON.stringify(loggedUser));
      showToast('success', '✅ Welcome Back', `Logged in as ${loggedUser.name}`);
      return loggedUser;
    } catch (err: any) {
      showToast('warning', '❌ Sign In Failed', err.message || 'Invalid email or password');
      throw err;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (e) {}
    setUser(null);
    setApiActor(null);
    localStorage.removeItem('lifelink_user');
    showToast('info', '👋 Logged Out', 'You have been signed out successfully.');
  };

  const signup = async (userData: Partial<User> & { password?: string, email: string }): Promise<User> => {
    try {
      const fbCred = await createUserWithEmailAndPassword(auth, userData.email, userData.password || 'temporary_pass');
      const token = await fbCred.user.getIdToken();
      setApiActor(token);

      // Create local SQL user
      const newUser = await api.createUser({ ...userData, firebaseUid: fbCred.user.uid });
      
      setUser(newUser);
      localStorage.setItem('lifelink_user', JSON.stringify(newUser));
      showToast('success', '🎉 Account Created', 'Registration successful!');
      await reloadUsersList();
      return newUser;
    } catch (err: any) {
      showToast('warning', '❌ Registration Failed', err.message || 'Could not register user');
      throw err;
    }
  };

  const googleSignIn = async (role?: 'Donor' | 'Patient' | 'Hospital' | 'Blood Bank'): Promise<User> => {
    try {
      const provider = new GoogleAuthProvider();
      const fbCred = await signInWithPopup(auth, provider);
      const token = await fbCred.user.getIdToken();
      setApiActor(token);

      const list = await api.getUsers();
      let sqlUser = list.find(u => u.id === fbCred.user.uid);
      
      if (!sqlUser) {
        if (!role) throw new Error("Role required for new registration.");
        sqlUser = await api.createUser({
          firebaseUid: fbCred.user.uid,
          name: fbCred.user.displayName || 'Unknown',
          email: fbCred.user.email || '',
          role,
          bloodType: role === 'Donor' ? 'O+' : 'Multiple',
          location: 'Coimbatore',
          status: 'Active',
          password: 'GOOGLE_AUTH'
        });
        showToast('success', '🎉 Account Created', 'Signed in with Google!');
      } else {
        showToast('success', '✅ Welcome Back', `Logged in as ${sqlUser.name}`);
      }
      
      setUser(sqlUser);
      localStorage.setItem('lifelink_user', JSON.stringify(sqlUser));
      await reloadUsersList();
      return sqlUser;
    } catch (err: any) {
      showToast('warning', '❌ Google Sign-In Failed', err.message || 'Could not sign in with Google');
      throw err;
    }
  };

  const refreshUser = async () => {
    await reloadUsersList();
  };

  const updateUserContext = async (updateData: any) => {
    if (!user) return;
    try {
      await api.updateUser(user.id, updateData);
      await reloadUsersList();
    } catch (err: any) {
      showToast('warning', '❌ Update Failed', err.message || 'Could not update profile');
      throw err;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoggedIn: !!user,
        logout,
        signup,
        login,
        googleSignIn,
        refreshUser,
        updateUserContext,
        usersList,
        reloadUsersList,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
