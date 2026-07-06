import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useElection } from '../contexts/ElectionContext';
import { useNavigate, Link } from 'react-router-dom';
import PhaseTracker from '../components/PhaseTracker';

export const Vote: React.FC = () => {
  const { student } = useAuth();
  const { config, currentPhase, approvedCandidates, castVotes } = useElection();
  const navigate = useNavigate();

  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Confirmation state (shown immediately after voting in-session)
  const [voteReceipt, setVoteReceipt] = useState<{
    code: string;
    timestamp: string;
    selections: string[]; // Names of candidates voted for
  } | null>(null);

  useEffect(() => {
    if (!student) {
      navigate('/login');
      return;
    }
  }, [student]);

  const handleSelection = (rollNo: string) => {
    setSelectedCandidates((prev) => {
      if (prev.includes(rollNo)) {
        return prev.filter((r) => r !== rollNo);
      } else {
        const seatsOpen = config?.seats_open || 2;
        if (prev.length >= seatsOpen) {
          // Block selection in UI
          return prev;
        }
        return [...prev, rollNo];
      }
    });
  };

  const handleCastVote = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!student) return;
    
    const seatsOpen = config?.seats_open || 2;
    if (selectedCandidates.length === 0) {
      setError('You must select at least 1 candidate.');
      return;
    }
    if (selectedCandidates.length > seatsOpen) {
      setError(`You can select a maximum of ${seatsOpen} candidates.`);
      return;
    }

    setSubmitting(true);
    try {
      const result = await castVotes(selectedCandidates);

      if (result.success) {
        // Generate a random confirmation receipt code
        const randomString = Math.random().toString(36).substring(2, 8).toUpperCase();
        const code = `VOTE-${student.roll_no}-${randomString}`;
        const timestamp = new Date().toISOString();

        // Get names of selected candidates for immediate session feedback
        const selections = selectedCandidates.map(
          (roll) => approvedCandidates.find((c) => c.candidate_roll_no === roll)?.name || roll
        );

        const receiptData = { code, timestamp, selections };
        setVoteReceipt(receiptData);
        
        // Optionally cache in sessionStorage for this tab session only
        sessionStorage.setItem('last_vote_receipt', JSON.stringify(receiptData));
      } else {
        setError(result.error || 'Failed to record vote. Please try again.');
      }
    } catch (err: any) {
      console.error('Voting error:', err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  // Check if session storage has the receipt from a previous action in the current tab session
  useEffect(() => {
    const cached = sessionStorage.getItem('last_vote_receipt');
    if (cached) {
      try {
        setVoteReceipt(JSON.parse(cached));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  if (!student) return null;

  // Render Confirmation Receipt (Immediate after voting, or sealed receipt for returns)
  if (student.has_voted) {
    const isImmediate = voteReceipt !== null;
    const displayCode = voteReceipt?.code || `VOTE-${student.roll_no}-SEALED`;
    const displayTime = voteReceipt ? new Date(voteReceipt.timestamp).toLocaleString() : 'N/A';
    const last6Code = displayCode.split('-').pop() || '';
    const stampDate = voteReceipt
      ? new Date(voteReceipt.timestamp).toLocaleDateString('en-GB')
      : 'SEALED';

    const downloadTextReceipt = () => {
      if (!student) return;
      const timeText = voteReceipt ? new Date(voteReceipt.timestamp).toLocaleString() : 'Confirmed in DB Ledger';
      const selectionsList = voteReceipt?.selections && voteReceipt.selections.length > 0
        ? voteReceipt.selections.map(name => ` - ${name}`).join('\n')
        : ' - [Selections Sealed/Private]';

      const text = `==================================================
DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING
NATIONAL INSTITUTE OF TECHNOLOGY UTTARAKHAND
==================================================
              OFFICIAL BALLOT RECEIPT
==================================================

VOTER RECORD:
-------------
Voter Roll Number : ${student.roll_no}
Voter Name        : ${student.name}
Verification Code : ${displayCode}
Timestamp         : ${timeText}
Status            : RECORDED (NIT UTTARAKHAND)

BALLOT SELECTIONS (PRIVATE SESSION RECORD):
-------------------------------------------
${selectionsList}

==================================================
This receipt confirms that your ballot has been 
officially deposited in the election ledger.

To preserve absolute ballot anonymity, individual 
voter selections are not stored in association 
with your profile in the database, and cannot be 
retrieved or displayed online once you close 
or refresh this page.
==================================================`;

      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ballot-receipt-${displayCode}.txt`;
      link.click();
      URL.revokeObjectURL(url);
    };

    return (
      <div style={{ flexGrow: 1 }}>
        <PhaseTracker />

        <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <h2 className="display-title" style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>
            Ballot Confirmation
          </h2>
          <p className="muted-text" style={{ fontSize: '0.9rem' }}>
            Your ballot has been officially deposited in the election ledger.
          </p>
        </header>

        {/* Rubber Stamp Signature Element */}
        <div className="stamp-container">
          <svg className="stamp-seal" viewBox="0 0 100 100">
            <defs>
              <path id="stamp-arc-top" d="M 15,50 A 35,35 0 1,1 85,50" />
              <path id="stamp-arc-bottom" d="M 85,50 A 35,35 0 0,1 15,50" />
            </defs>
            {/* Double bordered circles */}
            <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="2" fill="none" />
            <circle cx="50" cy="50" r="39" stroke="currentColor" strokeWidth="0.75" fill="none" />
            
            {/* Center text */}
            <text x="50" y="38" fontFamily="var(--font-sans)" fontSize="6" fontWeight="600" textAnchor="middle" fill="currentColor">
              BT24 CSE
            </text>
            <text x="50" y="49" fontFamily="var(--font-mono)" fontSize="8.5" fontWeight="700" textAnchor="middle" fill="currentColor">
              {last6Code}
            </text>
            <text x="50" y="60" fontFamily="var(--font-sans)" fontSize="6.5" fontWeight="700" textAnchor="middle" fill="currentColor">
              RECORDED
            </text>
            <text x="50" y="68" fontFamily="var(--font-mono)" fontSize="5.5" fontWeight="500" textAnchor="middle" fill="currentColor">
              {stampDate}
            </text>
            
            {/* Curved text */}
            <text fontFamily="var(--font-sans)" fontSize="5" fontWeight="700" fill="currentColor" letterSpacing="0.03em">
              <textPath href="#stamp-arc-top" startOffset="50%" textAnchor="middle">
                OFFICIAL ELECTORAL SEAL
              </textPath>
            </text>
            <text fontFamily="var(--font-sans)" fontSize="5" fontWeight="700" fill="currentColor" letterSpacing="0.03em">
              <textPath href="#stamp-arc-bottom" startOffset="50%" textAnchor="middle">
                NIT UTTARAKHAND
              </textPath>
            </text>
          </svg>

          <div className="stamp-receipt-box">
            <div className="muted-text" style={{ fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Receipt Verification Code
            </div>
            <div className="stamp-receipt-code mono-data">{displayCode}</div>
            
            {isImmediate && (
              <div style={{ marginTop: '1rem', borderTop: '1px solid var(--register)', paddingTop: '1rem' }}>
                <span className="muted-text" style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                  Ballot Selections (Private Record)
                </span>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {voteReceipt.selections.map((name, i) => (
                    <li key={i} style={{ fontWeight: 600, fontSize: '1rem' }}>
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'center' }}>
              Recorded: <span className="mono-data">{displayTime === 'N/A' ? 'Confirmed in DB Ledger' : displayTime}</span>
            </div>
          </div>
        </div>

        <div className="notice-box" style={{ fontSize: '0.85rem' }}>
          <div className="notice-title">Ballot Privacy Notice</div>
          <p>
            {isImmediate
              ? 'Please write down or screenshot this receipt if you want a record of your candidates. To preserve absolute ballot anonymity, individual voter selections are not stored in association with your profile in the database, and cannot be displayed once you leave or refresh this page.'
              : 'Your vote is recorded in the ledger. Individual selections are sealed and cannot be displayed to protect voter privacy.'}
          </p>
        </div>

        <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }} className="no-print">
          <Link to="/" className="btn btn-secondary">
            Return to Dashboard
          </Link>
          <button onClick={() => window.print()} className="btn">
            Print / Save PDF
          </button>
          <button onClick={downloadTextReceipt} className="btn btn-secondary" style={{ borderStyle: 'dashed' }}>
            Download Text Receipt
          </button>
        </div>
      </div>
    );
  }

  // Voting Phase Check (Voter hasn't voted yet)
  const isVotingOpen = currentPhase === 'voting';
  const seatsOpen = config?.seats_open || 2;

  return (
    <div style={{ flexGrow: 1 }}>
      <PhaseTracker />

      <header style={{ marginBottom: '2rem' }}>
        <h2 className="display-title" style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>
          Ballot Paper
        </h2>
        <p className="muted-text" style={{ fontSize: '0.9rem' }}>
          Select up to <span className="mono-data">{seatsOpen}</span> candidates. Your selections are completely private.
        </p>
      </header>

      {error && (
        <div className="notice-box error" role="alert">
          <div className="notice-title">Voting Error</div>
          <p style={{ fontSize: '0.9rem' }}>{error}</p>
        </div>
      )}

      {!isVotingOpen ? (
        <div className="notice-box">
          <div className="notice-title">Ballot Closed</div>
          <p style={{ fontSize: '0.9rem' }}>
            The voting phase is not active at this time. Refer to the dashboard timeline.
          </p>
          <div style={{ marginTop: '1.5rem' }}>
            <Link to="/" className="btn btn-secondary">Return to Dashboard</Link>
          </div>
        </div>
      ) : approvedCandidates.length === 0 ? (
        <div className="notice-box">
          <div className="notice-title">No Candidates</div>
          <p style={{ fontSize: '0.9rem' }}>
            There are no approved candidates on the ballot for this election.
          </p>
          <div style={{ marginTop: '1.5rem' }}>
            <Link to="/" className="btn btn-secondary">Return to Dashboard</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleCastVote}>
          <div className="ballot-container">
            {approvedCandidates.map((candidate) => {
              const isSelected = selectedCandidates.includes(candidate.candidate_roll_no);
              const isDisabled = !isSelected && selectedCandidates.length >= seatsOpen;

              return (
                <div key={candidate.candidate_roll_no} className="ballot-row">
                  <div className="ballot-selection">
                    <input
                      type="checkbox"
                      className="ballot-checkbox"
                      checked={isSelected}
                      onChange={() => handleSelection(candidate.candidate_roll_no)}
                      disabled={isDisabled || submitting}
                      aria-label={`Vote for ${candidate.name}`}
                    />
                  </div>

                  <div className="ballot-info candidate-row-with-photo">
                    {candidate.photo_url && (
                      <img
                        src={candidate.photo_url}
                        alt={candidate.name}
                        className="candidate-avatar"
                      />
                    )}
                    <div>
                      <div className="ballot-candidate-header">
                        <span className="ballot-candidate-name">{candidate.name}</span>
                        <span className="ballot-candidate-roll mono-data">{candidate.candidate_roll_no}</span>
                      </div>
                      <p className="ballot-candidate-statement">{candidate.statement}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem' }}>
            <div className="muted-text" style={{ fontSize: '0.85rem' }}>
              Selected: <span className="mono-data">{selectedCandidates.length}</span> of <span className="mono-data">{seatsOpen}</span>
            </div>
            
            <div style={{ display: 'flex', gap: '1rem' }}>
              <Link to="/" className="btn btn-secondary" style={{ border: 'none' }}>
                Cancel
              </Link>
              <button
                type="submit"
                className="btn"
                disabled={selectedCandidates.length === 0 || submitting}
              >
                {submitting ? 'Recording vote...' : 'Cast vote'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
};
export default Vote;
