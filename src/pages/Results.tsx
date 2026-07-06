import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useElection } from '../contexts/ElectionContext';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import PhaseTracker from '../components/PhaseTracker';

interface CandidateStat {
  candidate_roll_no: string;
  name: string;
  vote_count: string;
  percentage: number;
}

interface TurnoutData {
  total_roster: string;
  nominations_pending: string;
  nominations_approved: string;
  nominations_rejected: string;
  votes_cast: string;
  turnout_percentage: number;
}

export const Results: React.FC = () => {
  const { student } = useAuth();
  const { config } = useElection();
  const navigate = useNavigate();

  const [stats, setStats] = useState<CandidateStat[]>([]);
  const [turnout, setTurnout] = useState<TurnoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!student) {
      navigate('/login');
      return;
    }

    if (config && !config.results_published && !student.is_admin) {
      setError('Results are not published yet.');
      setLoading(false);
      return;
    }

    fetchResults();
  }, [student, config]);

  const fetchResults = async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch candidate stats
      const { data: statsData, error: statsError } = await supabase
        .rpc('get_candidate_stats');

      if (statsError) throw statsError;

      // 2. Fetch turnout stats
      const { data: turnoutData, error: turnoutError } = await supabase
        .rpc('get_turnout_stats');

      if (turnoutError) throw turnoutError;

      setStats(statsData as CandidateStat[]);
      if (turnoutData && turnoutData.length > 0) {
        setTurnout(turnoutData[0] as TurnoutData);
      }
    } catch (err: any) {
      console.error('Error fetching results:', err);
      setError(err.message || 'Failed to retrieve results from the database.');
    } finally {
      setLoading(false);
    }
  };

  // Winner logic including ties
  const getWinners = (statsList: CandidateStat[], seatsOpen = 2) => {
    if (statsList.length === 0) return [];
    
    // Sort descending by vote count
    const sorted = [...statsList].sort((a, b) => Number(b.vote_count) - Number(a.vote_count));
    
    if (sorted.length <= seatsOpen) {
      return sorted; // Everyone is a winner
    }
    
    const thresholdVoteCount = Number(sorted[seatsOpen - 1].vote_count);
    
    // Return all candidates who have at least the threshold votes (covers ties)
    return sorted.filter(c => Number(c.vote_count) >= thresholdVoteCount);
  };

  if (loading) {
    return <div className="mono-data" style={{ padding: '2rem', textAlign: 'center' }}>Tabulating results...</div>;
  }

  if (error) {
    return (
      <div>
        <PhaseTracker />
        <div className="notice-box error">
          <div className="notice-title">Results Unavailable</div>
          <p>{error}</p>
        </div>
        <Link to="/" className="btn btn-secondary">Return to Dashboard</Link>
      </div>
    );
  }

  const seatsOpen = config?.seats_open || 2;
  const winners = getWinners(stats, seatsOpen);
  const winnerRolls = winners.map(w => w.candidate_roll_no);
  const isTie = winners.length > seatsOpen;

  return (
    <div style={{ flexGrow: 1 }}>
      <PhaseTracker />

      <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <h2 className="display-title" style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>
          Election Results
        </h2>
        <p className="muted-text" style={{ fontSize: '0.9rem' }}>
          Certified results for the BT24 CSE Student Placement Representative election.
        </p>
      </header>

      {/* Winner Highlights */}
      <section className="winners-section">
        <h3 className="admin-section-title">
          {isTie ? 'Elected Representatives (Tie Declared)' : 'Elected Representatives'}
        </h3>
        
        {winners.length === 0 ? (
          <div className="notice-box">
            <p>No candidates were elected.</p>
          </div>
        ) : (
          winners.map((winner, idx) => (
            <div key={winner.candidate_roll_no} className="winner-row">
              <div style={{ marginRight: '1.5rem' }}>
                <span className="mono-data" style={{ fontSize: '0.75rem', display: 'block', color: 'var(--seal)', fontWeight: 600 }}>
                  SEAT ELECTED
                </span>
                <span className="mono-data" style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--seal)' }}>
                  #{idx + 1}
                </span>
              </div>
              <div>
                <span className="register-name" style={{ fontSize: '1.25rem' }}>{winner.name}</span>
                <span className="mono-data" style={{ fontSize: '0.95rem', marginLeft: '0.75rem', color: 'var(--muted)' }}>
                  {winner.candidate_roll_no}
                </span>
              </div>
              <div className="winner-seal-mark">ELECTED</div>
            </div>
          ))
        )}

        {isTie && (
          <div className="notice-box" style={{ borderColor: 'var(--seal)', backgroundColor: 'rgba(140, 47, 27, 0.02)', marginTop: '1rem' }}>
            <div className="notice-title" style={{ color: 'var(--seal)' }}>Note on Ties</div>
            <p style={{ fontSize: '0.85rem' }}>
              An exact tie occurred for the final seat. All tied candidates are displayed above. No silent tie-breaking was performed.
            </p>
          </div>
        )}
      </section>

      {/* Full Vote Breakdown */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h3 className="admin-section-title">Ballot Counts</h3>
        
        <div className="chart-container">
          {stats.map((cand) => {
            const isWinner = winnerRolls.includes(cand.candidate_roll_no);
            return (
              <div key={cand.candidate_roll_no} className="chart-bar-container">
                <div className="chart-bar-label">
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }} className={isWinner ? 'mono-data' : ''}>
                    {cand.name}
                  </div>
                  <div className="mono-data" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    {cand.candidate_roll_no}
                  </div>
                </div>
                <div className="chart-bar-fill-wrapper">
                  <div
                    className={`chart-bar-fill ${isWinner ? 'highlighted' : ''}`}
                    style={{ width: `${cand.percentage}%` }}
                  />
                  <span className="chart-bar-value">
                    {cand.vote_count} votes ({cand.percentage}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Turnout Statistics */}
      {turnout && (
        <section style={{ marginBottom: '2.5rem' }}>
          <h3 className="admin-section-title">Turnout Ledger</h3>
          <div className="register-table">
            <div className="register-row">
              <span className="register-badge">ELECTORAL ROSTER</span>
              <div className="register-content">
                <span className="mono-data">{turnout.total_roster} students</span>
              </div>
            </div>
            <div className="register-row">
              <span className="register-badge">BALLOTS CAST</span>
              <div className="register-content">
                <span className="mono-data">{turnout.votes_cast} ballots</span>
              </div>
            </div>
            <div className="register-row">
              <span className="register-badge">FINAL TURNOUT</span>
              <div className="register-content">
                <span className="mono-data" style={{ fontWeight: 700 }}>
                  {turnout.turnout_percentage}%
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Return button */}
      <div>
        <Link to="/" className="btn btn-secondary">
          Return to Dashboard
        </Link>
      </div>

    </div>
  );
};
export default Results;
