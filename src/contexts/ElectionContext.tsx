import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

export interface ElectionConfig {
  nomination_start: string;
  nomination_end: string;
  voting_start: string;
  voting_end: string;
  results_published: boolean;
  seats_open: number;
}

export interface Candidate {
  candidate_roll_no: string;
  name: string;
  statement: string;
  photo_url: string | null;
  status: string;
}

export type ElectionPhase = 'setup' | 'nomination' | 'review' | 'voting' | 'results';

interface ElectionContextType {
  config: ElectionConfig | null;
  currentPhase: ElectionPhase;
  approvedCandidates: Candidate[];
  loading: boolean;
  error: string | null;
  refreshConfig: () => Promise<void>;
  refreshCandidates: () => Promise<void>;
  castVotes: (candidateRollNos: string[]) => Promise<{ success: boolean; error?: string }>;
}

const ElectionContext = createContext<ElectionContextType | undefined>(undefined);

export const useElection = () => {
  const context = useContext(ElectionContext);
  if (!context) {
    throw new Error('useElection must be used within an ElectionProvider');
  }
  return context;
};

export const ElectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { student, refreshProfile } = useAuth();
  const [config, setConfig] = useState<ElectionConfig | null>(null);
  const [currentPhase, setCurrentPhase] = useState<ElectionPhase>('setup');
  const [approvedCandidates, setApprovedCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('election_config')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      if (fetchError) throw fetchError;
      
      if (data) {
        setConfig(data as ElectionConfig);
        determinePhase(data as ElectionConfig);
      }
    } catch (err: any) {
      console.error('Error fetching election config:', err);
      setError(err.message || 'Failed to load election configuration.');
    }
  };

  const determinePhase = (cfg: ElectionConfig) => {
    const now = new Date();
    const nomStart = new Date(cfg.nomination_start);
    // Add 5-minute grace period to nomination deadline
    const nomEnd = new Date(new Date(cfg.nomination_end).getTime() + 5 * 60 * 1000);
    const voteStart = new Date(cfg.voting_start);
    // Add 5-minute grace period to voting deadline
    const voteEnd = new Date(new Date(cfg.voting_end).getTime() + 5 * 60 * 1000);

    if (cfg.results_published && now > voteEnd) {
      setCurrentPhase('results');
    } else if (now >= nomStart && now <= nomEnd) {
      // Prioritize the nomination grace period so it takes precedence over voting start
      setCurrentPhase('nomination');
    } else if (now >= voteStart && now <= voteEnd) {
      // Voting can only start after the nomination grace period ends
      setCurrentPhase('voting');
    } else if (now > nomEnd && now < voteStart) {
      setCurrentPhase('review');
    } else if (now < nomStart) {
      // If it is before nomination window, we show nomination upcoming
      setCurrentPhase('nomination');
    } else {
      // Default fallback
      if (now > voteEnd) {
        // If voting ended but results not published, it's review/pre-publish results phase
        setCurrentPhase('review');
      } else {
        setCurrentPhase('nomination');
      }
    }
  };

  const fetchApprovedCandidates = async () => {
    try {
      // Fetch approved nominations and join with students to get their names
      const { data, error: candError } = await supabase
        .from('nominations')
        .select(`
          candidate_roll_no,
          statement,
          photo_url,
          status,
          students!nominations_candidate_roll_no_fkey ( name )
        `)
        .eq('status', 'approved');

      if (candError) throw candError;

      if (data) {
        const formatted: Candidate[] = data.map((item: any) => ({
          candidate_roll_no: item.candidate_roll_no,
          name: item.students?.name || 'Unknown',
          statement: item.statement,
          photo_url: item.photo_url,
          status: item.status
        }));
        setApprovedCandidates(formatted);
      }
    } catch (err: any) {
      console.error('Error fetching approved candidates:', err);
    }
  };

  const refreshConfig = async () => {
    setLoading(true);
    await fetchConfig();
    setLoading(false);
  };

  const refreshCandidates = async () => {
    await fetchApprovedCandidates();
  };

  // 1. Fetch config and candidates on login/mount
  useEffect(() => {
    if (student) {
      setLoading(true);
      Promise.all([fetchConfig(), fetchApprovedCandidates()]).finally(() => {
        setLoading(false);
      });
    } else {
      setConfig(null);
      setApprovedCandidates([]);
      setCurrentPhase('setup');
      setLoading(false);
    }
  }, [student]);

  // 2. Periodically check if the clock has crossed any phase boundaries (every 2 seconds)
  useEffect(() => {
    if (!config) return;

    // Run once immediately when config changes/loads
    determinePhase(config);

    const timer = setInterval(() => {
      determinePhase(config);
    }, 2000);

    return () => clearInterval(timer);
  }, [config]);

  const castVotes = async (candidateRollNos: string[]) => {
    if (!student) {
      return { success: false, error: 'You must be logged in to vote.' };
    }

    try {
      // Call the secure RPC function cast_votes
      const { error: rpcError } = await supabase.rpc('cast_votes', {
        voter_roll_no_input: student.roll_no,
        candidate_roll_nos_input: candidateRollNos
      });

      if (rpcError) {
        throw rpcError;
      }

      // Re-fetch profile to update has_voted
      await refreshProfile();
      return { success: true };
    } catch (err: any) {
      console.error('Exception casting votes:', err);
      return { success: false, error: err.message || 'Failed to submit votes.' };
    }
  };

  return (
    <ElectionContext.Provider
      value={{
        config,
        currentPhase,
        approvedCandidates,
        loading,
        error,
        refreshConfig,
        refreshCandidates,
        castVotes
      }}
    >
      {children}
    </ElectionContext.Provider>
  );
};
