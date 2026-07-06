import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useElection } from '../contexts/ElectionContext';
import { Link } from 'react-router-dom';
import PhaseTracker from '../components/PhaseTracker';

export const Dashboard: React.FC = () => {
  const { student } = useAuth();
  const { config, currentPhase } = useElection();

  if (!student) return null;

  // Formatting utility for timestamps
  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const getNominationStatusText = () => {
    if (student.is_admin) return 'Excluded (Admin)';
    if (!student.has_nominated) return 'Not Filed';
    return 'Submitted';
  };

  const getVotingStatusText = () => {
    return student.has_voted ? 'Recorded' : 'Not Cast';
  };

  return (
    <div style={{ flexGrow: 1 }}>
      
      {/* Stepper */}
      <PhaseTracker />

      {/* Main Panel */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 className="display-title" style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>
          Voter Profile
        </h2>
        
        <div className="register-table">
          <div className="register-row">
            <span className="register-badge">NAME</span>
            <div className="register-content">
              <span className="register-name">{student.name}</span>
            </div>
            <span className="register-action">
              {student.is_admin && (
                <span className="status-pill approved" style={{ marginRight: '0.5rem' }}>
                  ADMIN
                </span>
              )}
              <span className="status-pill approved">ELIGIBLE</span>
            </span>
          </div>

          <div className="register-row">
            <span className="register-badge">ROLL NUMBER</span>
            <div className="register-content">
              <span className="mono-data">{student.roll_no}</span>
            </div>
          </div>

          <div className="register-row">
            <span className="register-badge">NOMINATION</span>
            <div className="register-content">
              <span>{getNominationStatusText()}</span>
            </div>
            <span className="register-action">
              {student.has_nominated && (
                <Link to="/nominate" className="muted-text" style={{ fontSize: '0.85rem' }}>
                  View Statement
                </Link>
              )}
            </span>
          </div>

          <div className="register-row">
            <span className="register-badge">BALLOT STATUS</span>
            <div className="register-content">
              <span className="mono-data">{getVotingStatusText()}</span>
            </div>
            <span className="register-action">
              {student.has_voted && (
                <Link to="/vote" className="muted-text" style={{ fontSize: '0.85rem' }}>
                  View Receipt
                </Link>
              )}
            </span>
          </div>
        </div>
      </section>

      {/* Dynamic Phase Action Card */}
      <div style={{ border: '1px solid var(--ink)', padding: '2rem 1.5rem', marginBottom: '2.5rem' }}>
        
        {currentPhase === 'nomination' && (
          <div>
            <h3 className="display-title" style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>
              Phase I: Nominations Open
            </h3>
            
            <p style={{ marginBottom: '1.25rem' }}>
              Eligible batch members can nominate themselves to stand for the SPR positions. 
              The nomination window will close on <span className="mono-data">{formatTime(config?.nomination_end)}</span>.
            </p>

            {student.is_admin ? (
              <div className="notice-box" style={{ marginBottom: 0 }}>
                <p style={{ fontSize: '0.9rem' }}>
                  As an administrator, you are running this election and are excluded from standing. 
                  Access the <Link to="/admin">Admin Dashboard</Link> to review entries and manage schedules.
                </p>
              </div>
            ) : student.has_nominated ? (
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <Link to="/nominate" className="btn">
                  Edit Nomination Statement
                </Link>
                <span className="muted-text" style={{ fontSize: '0.85rem' }}>
                  Statement editable while pending review.
                </span>
              </div>
            ) : (
              <Link to="/nominate" className="btn">
                File Self-Nomination
              </Link>
            )}
          </div>
        )}

        {currentPhase === 'review' && (
          <div>
            <h3 className="display-title" style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>
              Phase II: Review & Prep
            </h3>
            <p style={{ marginBottom: '1.25rem' }}>
              The nomination window has closed. The list of candidates is currently undergoing review. 
              Voting will open on <span className="mono-data">{formatTime(config?.voting_start)}</span>.
            </p>
            {student.is_admin && (
              <Link to="/admin" className="btn">
                Open Review Queue
              </Link>
            )}
          </div>
        )}

        {currentPhase === 'voting' && (
          <div>
            <h3 className="display-title" style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>
              Phase III: Voting Open
            </h3>
            <p style={{ marginBottom: '1.25rem' }}>
              The ballot is officially open. You may cast your vote for up to <span className="mono-data">{config?.seats_open || 2}</span> candidates. 
              The polling window will close on <span className="mono-data">{formatTime(config?.voting_end)}</span>.
            </p>

            {student.has_voted ? (
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <Link to="/vote" className="btn btn-secondary">
                  View Vote Receipt
                </Link>
                <span className="muted-text" style={{ fontSize: '0.85rem' }}>
                  Your vote has been securely recorded.
                </span>
              </div>
            ) : (
              <Link to="/vote" className="btn">
                Access Ballot Paper
              </Link>
            )}
          </div>
        )}

        {currentPhase === 'results' && (
          <div>
            <h3 className="display-title" style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>
              Phase IV: Results
            </h3>
            {config?.results_published ? (
              <div>
                <p style={{ marginBottom: '1.25rem' }}>
                  The polls have closed and the final election results have been certified and published.
                </p>
                <Link to="/results" className="btn">
                  View Election Results
                </Link>
              </div>
            ) : (
              <div>
                <p style={{ marginBottom: '1.25rem' }}>
                  The polls have closed. The results are being tabulated and will be published shortly by the administrator.
                </p>
                {student.is_admin && (
                  <Link to="/admin" className="btn">
                    Tabulate and Publish Results
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Quick Info / Timeline */}
      <section>
        <h3 className="admin-section-title">Election Timeline</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', marginBottom: '1rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--ink)', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem 0', fontWeight: 600 }}>EVENT</th>
              <th style={{ padding: '0.5rem 0', fontWeight: 600, textAlign: 'right' }}>DATE & TIME</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--register)' }}>
              <td style={{ padding: '0.75rem 0' }}>Nominations Open</td>
              <td style={{ padding: '0.75rem 0', textAlign: 'right' }} className="mono-data">
                {formatTime(config?.nomination_start)}
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--register)' }}>
              <td style={{ padding: '0.75rem 0' }}>Nominations Close</td>
              <td style={{ padding: '0.75rem 0', textAlign: 'right' }} className="mono-data">
                {formatTime(config?.nomination_end)}
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--register)' }}>
              <td style={{ padding: '0.75rem 0' }}>Voting Opens</td>
              <td style={{ padding: '0.75rem 0', textAlign: 'right' }} className="mono-data">
                {formatTime(config?.voting_start)}
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--register)' }}>
              <td style={{ padding: '0.75rem 0' }}>Voting Closes</td>
              <td style={{ padding: '0.75rem 0', textAlign: 'right' }} className="mono-data">
                {formatTime(config?.voting_end)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

    </div>
  );
};
export default Dashboard;
