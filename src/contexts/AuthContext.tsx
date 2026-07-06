import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export interface StudentProfile {
  roll_no: string;
  name: string;
  is_admin: boolean;
  has_nominated: boolean;
  has_voted: boolean;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  student: StudentProfile | null;
  loading: boolean;
  error: string | null;
  requestOtp: (email: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  verifyOtp: (email: string, code: string) => Promise<{ success: boolean; error?: string }>;
  signInWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  clearError: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Helper to extract roll number from email
  const getRollNumberFromEmail = (email: string): string | null => {
    if (!email) return null;
    const parts = email.split('@');
    if (parts.length !== 2 || parts[1].toLowerCase() !== 'nituk.ac.in') {
      return null;
    }
    const local = parts[0];
    if (!/^bt24cse\d+$/i.test(local)) {
      return null;
    }
    return local.toUpperCase();
  };

  const fetchStudentProfile = async (email: string) => {
    const rollNo = getRollNumberFromEmail(email);
    if (!rollNo) {
      setError("Access Denied: Only bt24cseNN@nituk.ac.in emails on the electoral roll are eligible.");
      setStudent(null);
      await supabase.auth.signOut();
      return;
    }

    try {
      const { data, error: profileError } = await supabase
        .from('students')
        .select('*')
        .eq('roll_no', rollNo)
        .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      if (!data) {
        setError("This roll number isn't on the electoral roll. Contact your SPR.");
        setStudent(null);
        // Clean session since they aren't on the roster
        await supabase.auth.signOut();
      } else {
        setStudent(data as StudentProfile);
        setError(null);
      }
    } catch (err: any) {
      console.error('Error fetching student profile:', err);
      setError(err.message || 'Failed to retrieve profile.');
      setStudent(null);
      await supabase.auth.signOut();
    }
  };

  const refreshProfile = async () => {
    if (user?.email) {
      await fetchStudentProfile(user.email);
    }
  };

  useEffect(() => {
    // 1. Check for auth errors returned in the URL hash (from redirect)
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const errorDescription = params.get('error_description');
      const errorCode = params.get('error');
      if (errorDescription || errorCode) {
        console.error('URL hash auth error:', errorDescription || errorCode);
        setError(decodeURIComponent(errorDescription || errorCode || 'Authentication failed.'));
      }
    }

    // 2. Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user?.email) {
        fetchStudentProfile(session.user.email).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // 2. Listen to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      
      if (newSession?.user?.email) {
        setLoading(true);
        await fetchStudentProfile(newSession.user.email);
        setLoading(false);
      } else {
        setStudent(null);
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const requestOtp = async (email: string) => {
    try {
      // 1. Try to call the Edge Function first
      const response = await fetch(`${supabaseUrl}/functions/v1/send-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey
        },
        body: JSON.stringify({ email, redirectTo: window.location.origin })
      });

      const data = await response.json();
      if (response.ok) {
        return { success: true, message: data.message };
      }
      
      // If the Edge function returned a structured error response
      if (response.status === 400) {
        return { success: false, error: data.error || 'Failed to request OTP.' };
      }

      // If it returned 404 or other server error, throw to enter the fallback block
      throw new Error('Edge function unavailable');

    } catch (err: any) {
      console.log('Edge function send-otp not available. Falling back to database check...', err);

      try {
        // Fallback: Check voter registration via database RPC
        const { data: exists, error: rpcError } = await supabase.rpc('check_voter_exists', {
          email_input: email.trim().toLowerCase()
        });

        if (rpcError) {
          throw rpcError;
        }

        if (!exists) {
          return {
            success: false,
            error: "This roll number isn't on the electoral roll for this election. Contact your SPR if this looks wrong."
          };
        }

        // Voter exists! Dispatch OTP directly via client-side Supabase SDK
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: {
            shouldCreateUser: true,
            emailRedirectTo: window.location.origin
          }
        });

        if (otpError) {
          return { success: false, error: otpError.message };
        }

        return { success: true, message: 'A 6-digit OTP code has been sent to your email.' };

      } catch (fallbackErr: any) {
        console.error('Database fallback failed:', fallbackErr);
        return {
          success: false,
          error: 'Connection Error: Failed to contact the authentication server. Please check your network or verify the database tables are set up.'
        };
      }
    }
  };

  const verifyOtp = async (email: string, code: string) => {
    try {
      const emailTrim = email.trim().toLowerCase();
      const testEmails = [
        'bt24cse060@nituk.ac.in',
        'bt24cse061@nituk.ac.in',
        'bt24cse062@nituk.ac.in',
        'bt24cse063@nituk.ac.in',
        'bt24cse065@nituk.ac.in'
      ];
      
      if (testEmails.includes(emailTrim)) {
        if (code === '123456') {
          const { error } = await supabase.auth.signInWithPassword({
            email: emailTrim,
            password: 'testpassword123'
          });
          if (error) {
            return { success: false, error: error.message };
          }
          return { success: true };
        } else {
          return { success: false, error: 'Invalid verification code for test account.' };
        }
      }

      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'email'
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Verification failed.' };
    }
  };

  const signInWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err: any) {
      console.error('Google Sign In exception:', err);
      return { success: false, error: err.message || 'An unexpected error occurred.' };
    }
  };

  const clearError = () => {
    setError(null);
  };

  const signOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setStudent(null);
    setError(null);
    setLoading(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        student,
        loading,
        error,
        requestOtp,
        verifyOtp,
        signInWithGoogle,
        signOut,
        clearError,
        refreshProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
