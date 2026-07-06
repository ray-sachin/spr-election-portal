import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useElection } from '../contexts/ElectionContext';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import PhaseTracker from '../components/PhaseTracker';

interface PendingNomination {
  id: string;
  candidate_roll_no: string;
  statement: string;
  photo_url: string | null;
  status: string;
  submitted_at: string;
  students: {
    name: string;
  };
}

interface StatsReport {
  total_roster: number;
  nominations_pending: number;
  nominations_approved: number;
  nominations_rejected: number;
  votes_cast: number;
  turnout_percentage: number;
}

interface VoteTimePoint {
  time_bucket: string;
  cumulative_votes: number;
}

interface VoterAuditRecord {
  id: number;
  voter_roll_no: string;
  candidate_roll_no: string;
  cast_at: string;
  voter?: { name: string };
  candidate?: { name: string };
}

// Helper to format ISO string to IST (UTC+5:30) YYYY-MM-DDTHH:mm format for datetime-local input
const toISTDateTimeString = (isoString: string) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  // IST is UTC + 5.5 hours (19800000 ms)
  const istTime = new Date(date.getTime() + 19800000);
  return istTime.toISOString().slice(0, 16);
};

export const Admin: React.FC = () => {
  const { student } = useAuth();
  const { config, refreshConfig, refreshCandidates } = useElection();
  const navigate = useNavigate();

  // Page States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reportTime, setReportTime] = useState<string>('');

  // Config States
  const [nomStart, setNomStart] = useState('');
  const [nomEnd, setNomEnd] = useState('');
  const [voteStart, setVoteStart] = useState('');
  const [voteEnd, setVoteEnd] = useState('');
  const [seatsOpen, setSeatsOpen] = useState(2);
  const [resultsPublished, setResultsPublished] = useState(false);
  const [updatingConfig, setUpdatingConfig] = useState(false);

  // CSV Roster Import States
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Review Queue
  const [pendingNominations, setPendingNominations] = useState<PendingNomination[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  // Stats Dashboard
  const [report, setReport] = useState<StatsReport | null>(null);
  const [candidateStats, setCandidateStats] = useState<any[]>([]);
  const [voteSeries, setVoteSeries] = useState<VoteTimePoint[]>([]);

  // Voter Audit Log (Only readable/visible to BT24CSE001)
  const [auditLog, setAuditLog] = useState<VoterAuditRecord[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  useEffect(() => {
    if (!student) {
      navigate('/login');
      return;
    }
    if (!student.is_admin) {
      setError('Access Restricted: Administrators only.');
      setLoading(false);
      return;
    }

    loadAdminData();
  }, [student, config]);

  const loadAdminData = async () => {
    try {
      setLoading(true);
      setReportTime(new Date().toLocaleString());

      if (config) {
        setNomStart(toISTDateTimeString(config.nomination_start));
        setNomEnd(toISTDateTimeString(config.nomination_end));
        setVoteStart(toISTDateTimeString(config.voting_start));
        setVoteEnd(toISTDateTimeString(config.voting_end));
        setSeatsOpen(config.seats_open);
        setResultsPublished(config.results_published);
      }

      const promises: Promise<any>[] = [
        fetchPendingNominations(),
        fetchTurnoutReport(),
        fetchLiveLeaderboard(),
        fetchVoteTimeSeries()
      ];

      if (student?.roll_no === 'BT24CSE001') {
        promises.push(fetchAuditLog());
      }

      await Promise.all(promises);
    } catch (err: any) {
      console.error('Error loading admin data:', err);
      setError(err.message || 'Failed to populate admin panels.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditLog = async () => {
    if (student?.roll_no !== 'BT24CSE001') return;
    setLoadingAudit(true);
    try {
      const { data, error: auditErr } = await supabase
        .from('votes')
        .select(`
          id,
          voter_roll_no,
          candidate_roll_no,
          cast_at,
          voter:students!votes_voter_roll_no_fkey ( name ),
          candidate:students!votes_candidate_roll_no_fkey ( name )
        `)
        .order('cast_at', { ascending: false });

      if (auditErr) {
        console.warn('Audit Log fetch error:', auditErr);
      } else {
        setAuditLog((data || []) as any[]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAudit(false);
    }
  };

  const fetchPendingNominations = async () => {
    const { data, error: qErr } = await supabase
      .from('nominations')
      .select(`
        id,
        candidate_roll_no,
        statement,
        photo_url,
        status,
        submitted_at,
        students!nominations_candidate_roll_no_fkey ( name )
      `)
      .eq('status', 'pending');

    if (qErr) throw qErr;
    setPendingNominations((data || []) as any[]);
  };

  const fetchTurnoutReport = async () => {
    const { data, error: rpcErr } = await supabase.rpc('get_turnout_stats');
    if (rpcErr) throw rpcErr;
    if (data && data.length > 0) {
      setReport(data[0] as StatsReport);
    }
  };

  const fetchLiveLeaderboard = async () => {
    const { data, error: statsErr } = await supabase.rpc('get_candidate_stats');
    // Ignore error if results aren't published and RPC throws, since admins can read it anyway.
    // If RPC failed due to admin permissions, we do a manual aggregate
    if (statsErr) {
      // Manual aggregate if needed, but since RPC is SECURITY DEFINER and checks is_admin, it should succeed for admins
      console.warn('Leaderboard RPC error:', statsErr);
    } else {
      setCandidateStats(data || []);
    }
  };

  const fetchVoteTimeSeries = async () => {
    const { data, error: timeErr } = await supabase.rpc('get_vote_timeseries');
    if (timeErr) {
      console.warn('TimeSeries error:', timeErr);
    } else {
      setVoteSeries(data || []);
    }
  };

  const handleUpdateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setUpdatingConfig(true);

    // Helper to parse input string as IST date
    const parseIST = (dateTimeStr: string) => {
      if (!dateTimeStr) return new Date().toISOString();
      return new Date(dateTimeStr + ':00+05:30').toISOString();
    };

    try {
      const { error: updateErr } = await supabase
        .from('election_config')
        .update({
          nomination_start: parseIST(nomStart),
          nomination_end: parseIST(nomEnd),
          voting_start: parseIST(voteStart),
          voting_end: parseIST(voteEnd),
          seats_open: seatsOpen,
          results_published: resultsPublished
        })
        .eq('id', 1);

      if (updateErr) throw updateErr;

      setSuccess('Election schedules and settings successfully updated.');
      await refreshConfig();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to update configuration.');
    } finally {
      setUpdatingConfig(false);
    }
  };

  const handleReviewNomination = async (id: string, newStatus: 'approved' | 'rejected') => {
    setError(null);
    setSuccess(null);
    setReviewingId(id);

    try {
      const { error: reviewErr } = await supabase
        .from('nominations')
        .update({
          status: newStatus,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', id);

      if (reviewErr) throw reviewErr;

      setSuccess(`Nomination status updated to ${newStatus.toUpperCase()}.`);
      await fetchPendingNominations();
      await fetchTurnoutReport();
      await fetchLiveLeaderboard();
      await refreshCandidates();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to record review decision.');
    } finally {
      setReviewingId(null);
    }
  };

  const handleCSVImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile) return;

    setError(null);
    setImportSummary(null);
    setImporting(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) throw new Error('CSV file is empty.');

        const parsed = parseCSVText(text);
        if (parsed.length === 0) {
          throw new Error('No valid student records found in CSV.');
        }

        // Upsert into Supabase students table
        const { error: upsertErr } = await supabase
          .from('students')
          .upsert(
            parsed.map(s => ({ roll_no: s.roll_no, name: s.name })),
            { onConflict: 'roll_no' }
          );

        if (upsertErr) throw upsertErr;

        setImportSummary(`Successfully processed and upserted ${parsed.length} student records.`);
        setCsvFile(null);
        await fetchTurnoutReport();
      } catch (err: any) {
        console.error(err);
        setError('CSV Import Failed: ' + (err.message || 'Invalid format.'));
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(csvFile);
  };

  const parseCSVText = (text: string) => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
    
    // Find index based on case-insensitive matches
    const rollNoIdx = headers.findIndex(h => h === 'roll no' || h === 'roll_number' || h === 'rollno');
    const nameIdx = headers.findIndex(h => h === 'name' || h === 'name of the applicant' || h === 'applicant name');

    if (rollNoIdx === -1 || nameIdx === -1) {
      throw new Error(`Could not find ROLL NO or NAME headers. Headers read: [${headers.join(', ')}]`);
    }

    const list: { roll_no: string; name: string }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const row = splitCSVLine(lines[i]);
      if (row.length <= Math.max(rollNoIdx, nameIdx)) continue;

      const roll = row[rollNoIdx].trim().toUpperCase().replace(/^["']|["']$/g, '');
      let name = row[nameIdx].trim().replace(/^["']|["']$/g, '');

      // Trim honorifics: Mr., Ms., Mrs., Dr., Prof. (case insensitive)
      name = name.replace(/^(mr|ms|mrs|dr|prof)\.?\s+/i, '').trim();

      if (roll && name) {
        list.push({ roll_no: roll, name: name });
      }
    }
    return list;
  };

  const splitCSVLine = (line: string) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };

  const handleExportCSV = () => {
    if (candidateStats.length === 0) return;

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Rank,Roll Number,Name,Votes Cast,Percentage\n';
    
    candidateStats.forEach((cand, idx) => {
      csvContent += `${idx + 1},${cand.candidate_roll_no},"${cand.name}",${cand.vote_count},${cand.percentage}%\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `SPR_Election_Results_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Simple responsive SVG line chart builder
  const renderLineChart = () => {
    if (voteSeries.length < 2) {
      return (
        <div style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: '0.85rem' }} className="muted-text">
          Waiting for multiple ballots to render timeline data...
        </div>
      );
    }

    const width = 600;
    const height = 200;
    const padding = 35;

    const xMax = voteSeries.length - 1;
    const yMax = Math.max(...voteSeries.map(p => Number(p.cumulative_votes))) || 1;

    // Map points to SVG coordinates
    const points = voteSeries.map((p, idx) => {
      const x = padding + (idx / xMax) * (width - 2 * padding);
      const y = height - padding - (Number(p.cumulative_votes) / yMax) * (height - 2 * padding);
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', backgroundColor: '#fcfcfb' }}>
        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding + ratio * (height - 2 * padding);
          const value = Math.round(yMax - ratio * yMax);
          return (
            <g key={ratio}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} className="line-chart-grid" />
              <text x={padding - 5} y={y + 3} textAnchor="end" className="line-chart-text">{value}</text>
            </g>
          );
        })}

        {/* X Axis labels (timestamps) */}
        {voteSeries.map((p, idx) => {
          if (idx === 0 || idx === voteSeries.length - 1 || (voteSeries.length > 5 && idx === Math.round(xMax / 2))) {
            const x = padding + (idx / xMax) * (width - 2 * padding);
            const timeStr = new Date(p.time_bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return (
              <text key={idx} x={x} y={height - padding + 15} textAnchor="middle" className="line-chart-text">
                {timeStr}
              </text>
            );
          }
          return null;
        })}

        {/* Axes */}
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="line-chart-axis" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="line-chart-axis" />

        {/* Line path */}
        <polyline points={points} className="line-chart-path" />

        {/* Data points */}
        {voteSeries.map((p, idx) => {
          const x = padding + (idx / xMax) * (width - 2 * padding);
          const y = height - padding - (Number(p.cumulative_votes) / yMax) * (height - 2 * padding);
          return (
            <circle key={idx} cx={x} cy={y} r="3" fill="var(--ink)" />
          );
        })}
      </svg>
    );
  };

  if (loading) {
    return <div className="mono-data" style={{ padding: '2rem', textAlign: 'center' }}>Loading administrative dashboard...</div>;
  }

  if (error && !student?.is_admin) {
    return (
      <div className="notice-box error">
        <div className="notice-title">Access Denied</div>
        <p>{error}</p>
        <div style={{ marginTop: '1.5rem' }}>
          <Link to="/" className="btn btn-secondary">Return to Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flexGrow: 1 }}>
      <PhaseTracker />

      <header style={{ marginBottom: '2rem', borderBottom: '1px solid var(--register)', paddingBottom: '1rem' }}>
        <h2 className="display-title" style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>
          Admin Dashboard
        </h2>
        <p className="muted-text" style={{ fontSize: '0.85rem' }}>
          Electoral registry controls. Report generated: <span className="mono-data">{reportTime}</span>
        </p>
      </header>

      {error && (
        <div className="notice-box error" role="alert">
          <div className="notice-title">Operation Failed</div>
          <p style={{ fontSize: '0.9rem' }}>{error}</p>
        </div>
      )}

      {success && (
        <div className="notice-box success" role="status">
          <div className="notice-title">Success</div>
          <p style={{ fontSize: '0.9rem' }}>{success}</p>
        </div>
      )}

      {/* Roster & Stats Summary */}
      {report && (
        <section className="admin-stats-summary">
          <div className="admin-stat-card">
            <div className="admin-stat-num">{report.total_roster}</div>
            <div className="admin-stat-label">Eligible Voters</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-num">{report.votes_cast}</div>
            <div className="admin-stat-label">Turnout ({report.turnout_percentage}%)</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-num">{report.nominations_pending}</div>
            <div className="admin-stat-label">Pending Reviews</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-num">
              {Number(report.nominations_approved) + Number(report.nominations_rejected)}
            </div>
            <div className="admin-stat-label">Reviewed Nominations</div>
          </div>
        </section>
      )}

      {/* Phase Configuration Form */}
      <section style={{ marginBottom: '3rem' }}>
        <h3 className="admin-section-title">Schedule & Settings</h3>
        <form onSubmit={handleUpdateConfig} style={{ border: '1px solid var(--ink)', padding: '1.5rem', backgroundColor: 'var(--paper)' }}>
          <div className="admin-config-grid">
            <div className="form-group">
              <label htmlFor="nom-start">Nomination Start</label>
              <input
                id="nom-start"
                type="datetime-local"
                className="input-field mono"
                value={nomStart}
                onChange={(e) => setNomStart(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="nom-end">Nomination End</label>
              <input
                id="nom-end"
                type="datetime-local"
                className="input-field mono"
                value={nomEnd}
                onChange={(e) => setNomEnd(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="admin-config-grid">
            <div className="form-group">
              <label htmlFor="vote-start">Voting Start</label>
              <input
                id="vote-start"
                type="datetime-local"
                className="input-field mono"
                value={voteStart}
                onChange={(e) => setVoteStart(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="vote-end">Voting End</label>
              <input
                id="vote-end"
                type="datetime-local"
                className="input-field mono"
                value={voteEnd}
                onChange={(e) => setVoteEnd(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="admin-config-grid" style={{ alignItems: 'center' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="seats-open">Seats Open</label>
              <input
                id="seats-open"
                type="number"
                min={1}
                className="input-field mono"
                value={seatsOpen}
                onChange={(e) => setSeatsOpen(Number(e.target.value))}
                required
              />
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.5rem', marginBottom: 0 }}>
              <input
                id="publish-results"
                type="checkbox"
                style={{ width: '1.1rem', height: '1.1rem', cursor: 'pointer' }}
                checked={resultsPublished}
                onChange={(e) => setResultsPublished(e.target.checked)}
              />
              <label htmlFor="publish-results" style={{ marginBottom: 0, cursor: 'pointer', textTransform: 'none' }}>
                Publish Results to Voters
              </label>
            </div>
          </div>

          <button type="submit" className="btn" style={{ marginTop: '1.5rem' }} disabled={updatingConfig}>
            {updatingConfig ? 'Saving settings...' : 'Update Config'}
          </button>
        </form>
      </section>

      {/* CSV Import */}
      <section style={{ marginBottom: '3rem' }}>
        <h3 className="admin-section-title">Import Electoral Roster</h3>
        
        {importSummary && (
          <div className="notice-box success" style={{ marginBottom: '1rem' }}>
            <div className="notice-title">Import Complete</div>
            <p>{importSummary}</p>
          </div>
        )}

        <form onSubmit={handleCSVImport} style={{ border: '1px solid var(--register)', padding: '1.5rem' }}>
          <p style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Upload CSV with student list. Headers matched case-insensitively (<span className="mono-data">ROLL NO</span> / <span className="mono-data">roll_number</span>, <span className="mono-data">NAME</span> / <span className="mono-data">Name of the Applicant</span>). Values will be upserted.
          </p>

          <div style={{ marginBottom: '1rem' }}>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              disabled={importing}
              required
            />
          </div>

          <button type="submit" className="btn btn-secondary" disabled={!csvFile || importing}>
            {importing ? 'Upserting database...' : 'Run Roster Import'}
          </button>
        </form>
      </section>

      {/* Pending Nomination Queue */}
      <section style={{ marginBottom: '3rem' }}>
        <h3 className="admin-section-title">Nomination Review Queue</h3>
        {pendingNominations.length === 0 ? (
          <p style={{ fontStyle: 'italic', color: 'var(--muted)', fontSize: '0.9rem' }}>
            No pending nominations awaiting review.
          </p>
        ) : (
          <div className="register-table">
            {pendingNominations.map((nom) => (
              <div key={nom.id} className="register-row" style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
                <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <div>
                    <span className="register-name">{nom.students?.name}</span>
                    <span className="mono-data" style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
                      {nom.candidate_roll_no}
                    </span>
                  </div>
                  <span className="mono-data" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    Submitted: {new Date(nom.submitted_at).toLocaleString()}
                  </span>
                </div>
                
                {nom.photo_url && (
                  <img src={nom.photo_url} alt={nom.students?.name} className="candidate-photo-preview" style={{ marginBottom: '0.5rem' }} />
                )}

                <p style={{ fontSize: '0.9rem', marginBottom: '1rem', whiteSpace: 'pre-wrap', width: '100%', padding: '0.75rem', borderLeft: '2px solid var(--register)', backgroundColor: 'rgba(201, 199, 190, 0.05)' }}>
                  {nom.statement}
                </p>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', borderColor: 'var(--verified)', color: 'var(--verified)' }}
                    onClick={() => handleReviewNomination(nom.id, 'approved')}
                    disabled={reviewingId !== null}
                  >
                    Approve
                  </button>
                  <button
                    className="btn btn-danger"
                    style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}
                    onClick={() => handleReviewNomination(nom.id, 'rejected')}
                    disabled={reviewingId !== null}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Time-series Cumulative Chart */}
      <section style={{ marginBottom: '3rem' }}>
        <h3 className="admin-section-title">Ballot Flow (Cumulative Votes)</h3>
        <div style={{ marginTop: '1rem' }}>
          {renderLineChart()}
        </div>
      </section>

      {/* Live Ballots Breakdown & Export */}
      <section style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 className="admin-section-title" style={{ flexGrow: 1, border: 'none', marginBottom: 0 }}>
            Live Standings
          </h3>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }} onClick={handleExportCSV}>
            Export CSV Report
          </button>
        </div>

        {candidateStats.length === 0 ? (
          <p style={{ fontStyle: 'italic', color: 'var(--muted)', fontSize: '0.9rem', marginTop: '1rem' }}>
            No votes have been cast yet.
          </p>
        ) : (
          <div className="register-table" style={{ marginTop: '1rem' }}>
            {candidateStats.map((cand, idx) => (
              <div key={cand.candidate_roll_no} className="register-row">
                <span className="register-badge">RANK #{idx + 1}</span>
                <div className="register-content">
                  <span className="register-name">{cand.name}</span>
                  <span className="mono-data" style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
                    {cand.candidate_roll_no}
                  </span>
                </div>
                <span className="register-action mono-data" style={{ fontWeight: 600 }}>
                  {cand.vote_count} votes ({cand.percentage}%)
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Secure Voter Audit Log - STRICTLY BT24CSE001 ONLY */}
      {student?.roll_no === 'BT24CSE001' && (
        <section style={{ marginBottom: '3rem' }}>
          <h3 className="admin-section-title" style={{ borderColor: 'var(--error-border)', color: 'var(--ink)' }}>
            🔒 Secure Voter Audit Log (Strictly Confidential - BT24CSE001 Only)
          </h3>
          <p style={{ fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            This panel is protected by database Row-Level Security and is physically invisible/unreachable to any other administrator. It lists the raw individual votes for auditing.
          </p>

          {loadingAudit ? (
            <div className="mono-data" style={{ fontStyle: 'italic', fontSize: '0.85rem' }}>Loading secure logs...</div>
          ) : auditLog.length === 0 ? (
            <p style={{ fontStyle: 'italic', color: 'var(--muted)', fontSize: '0.9rem' }}>
              No votes recorded in the database yet.
            </p>
          ) : (
            <div className="register-table" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {auditLog.map((log) => (
                <div key={log.id} className="register-row">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--muted)' }}>Voter:</span>
                      <span className="register-name">{log.voter?.name || 'Unknown'}</span>
                      <span className="mono-data" style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>({log.voter_roll_no})</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--muted)' }}>Voted For:</span>
                      <span style={{ fontWeight: 600 }}>{log.candidate?.name || 'Unknown'}</span>
                      <span className="mono-data" style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>({log.candidate_roll_no})</span>
                    </div>
                  </div>
                  <span className="mono-data" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    {new Date(log.cast_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div>
        <Link to="/" className="btn btn-secondary">
          Return to Dashboard
        </Link>
      </div>

    </div>
  );
};
export default Admin;
