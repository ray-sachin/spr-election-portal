import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useElection } from '../contexts/ElectionContext';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import PhaseTracker from '../components/PhaseTracker';

interface NominationRecord {
  id: string;
  candidate_roll_no: string;
  statement: string;
  photo_url: string | null;
  status: string;
  submitted_at: string;
  rejection_count: number;
  rejection_reason: string | null;
}

export const Nominate: React.FC = () => {
  const { student, refreshProfile } = useAuth();
  const { config } = useElection();
  const navigate = useNavigate();

  const [statement, setStatement] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [nomination, setNomination] = useState<NominationRecord | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Character limit
  const maxChars = 600;

  useEffect(() => {
    if (!student) {
      navigate('/login');
      return;
    }
    if (student.is_admin) {
      setLoading(false);
      return;
    }
    fetchNomination();
  }, [student]);

  const fetchNomination = async () => {
    if (!student) return;
    try {
      setLoading(true);
      const { data, error: fetchErr } = await supabase
        .from('nominations')
        .select('*')
        .eq('candidate_roll_no', student.roll_no)
        .maybeSingle();

      if (fetchErr) throw fetchErr;

      const savedDraft = localStorage.getItem(`nomination_draft_statement_${student.roll_no}`);

      if (data) {
        setNomination(data as NominationRecord);
        // If a local draft exists, prioritize it as the user's unsaved changes
        setStatement(savedDraft !== null ? savedDraft : data.statement);
        setPhotoUrl(data.photo_url || '');
      } else {
        if (savedDraft) {
          setStatement(savedDraft);
        }
      }
    } catch (err: any) {
      console.error('Error fetching nomination:', err);
      setError('Could not retrieve nomination details.');
    } finally {
      setLoading(false);
    }
  };

  const handleStatementChange = (text: string) => {
    setStatement(text);
    if (student) {
      localStorage.setItem(`nomination_draft_statement_${student.roll_no}`, text);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !student) return;

    // 1. Validate size (< 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setError('Photo file size must be less than 2MB.');
      return;
    }

    // 2. Validate MIME type
    if (!file.type.startsWith('image/')) {
      setError('Only image files (JPEG, PNG, WEBP) are allowed.');
      return;
    }

    // 3. Validate file extension (Strict whitelist check)
    const rawExt = file.name.split('.').pop()?.toLowerCase();
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
    if (!rawExt || !allowedExts.includes(rawExt)) {
      setError('Only files with .jpg, .jpeg, .png, or .webp extensions are allowed.');
      return;
    }

    // Map extensions to normalize them
    const fileExt = rawExt === 'jpeg' ? 'jpg' : rawExt;

    // 4. Validate magic bytes (Strict file signature check)
    setError(null);
    setUploadProgress('Validating file integrity...');

    const validateMagicBytes = async (f: File): Promise<boolean> => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = (event) => {
          if (!event.target || !event.target.result) {
            resolve(false);
            return;
          }
          const arr = new Uint8Array(event.target.result as ArrayBuffer).subarray(0, 4);
          let header = '';
          for (let i = 0; i < arr.length; i++) {
            header += arr[i].toString(16).toUpperCase().padStart(2, '0');
          }
          
          // PNG signature: 89504E47
          // JPEG signature: FFD8FF
          // WEBP signature: 52494646 (RIFF)
          const isPng = header === '89504E47';
          const isJpeg = header.startsWith('FFD8FF');
          const isWebp = header === '52494646';
          
          resolve(isPng || isJpeg || isWebp);
        };
        reader.readAsArrayBuffer(f.slice(0, 4));
      });
    };

    const isValidImage = await validateMagicBytes(file);
    if (!isValidImage) {
      setError('Invalid file structure. The uploaded file is not a valid image.');
      setUploadProgress(null);
      return;
    }

    setUploadProgress('Uploading...');

    try {
      // 5. Sanitize and format the destination file name (forces a clean extension)
      const fileName = `photos/${student.roll_no}_${Date.now()}.${fileExt}`;

      // Upload file to storage bucket
      const { error: uploadError } = await supabase.storage
        .from('candidate-photos')
        .upload(fileName, file, { cacheControl: '3600', upsert: true });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('candidate-photos')
        .getPublicUrl(fileName);

      setPhotoUrl(publicUrl);
      setUploadProgress('Upload complete.');
    } catch (err: any) {
      console.error('Storage upload error:', err);
      setError(
        'Upload failed. The storage bucket may not be configured. You can still paste a direct image link below if needed.'
      );
      setUploadProgress(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!student) return;

    if (!statement.trim()) {
      setError('Nomination statement cannot be empty.');
      return;
    }

    if (statement.length > maxChars) {
      setError(`Statement exceeds the limit of ${maxChars} characters.`);
      return;
    }

    // Check nomination window (client side date check, DB trigger will enforce server clock)
    const now = new Date();
    if (config) {
      const nomStart = new Date(config.nomination_start);
      // Add 5-minute grace period to nomination deadline
      const nomEnd = new Date(new Date(config.nomination_end).getTime() + 5 * 60 * 1000);
      if (now < nomStart || now > nomEnd) {
        setError('Nomination window is closed.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (nomination) {
        // Update existing nomination
        const { error: updateErr } = await supabase
          .from('nominations')
          .update({
            statement: statement.trim(),
            photo_url: photoUrl.trim() || null,
            status: 'pending', // Revert to pending on edit
            rejection_reason: null // Clear old rejection reason feedback
          })
          .eq('id', nomination.id);

        if (updateErr) throw updateErr;

        setSuccess('Your nomination has been successfully updated.');
        setIsEditing(false);
      } else {
        // Create new nomination
        const { error: insertErr } = await supabase
          .from('nominations')
          .insert({
            candidate_roll_no: student.roll_no,
            statement: statement.trim(),
            photo_url: photoUrl.trim() || null,
            status: 'pending'
          });

        if (insertErr) throw insertErr;

        setSuccess('Your nomination has been successfully recorded.');
      }

      // Clear local draft cache on successful submission
      localStorage.removeItem(`nomination_draft_statement_${student.roll_no}`);

      await refreshProfile();
      await fetchNomination();
    } catch (err: any) {
      console.error('Submission error:', err);
      setError(err.message || 'An error occurred during submission.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="mono-data" style={{ padding: '2rem', textAlign: 'center' }}>Retrieving nomination ledger...</div>;
  }

  if (student?.is_admin) {
    return (
      <div>
        <PhaseTracker />
        <div className="notice-box error">
          <div className="notice-title">Access Restricted</div>
          <p>Administrators are running this election and are excluded from running in it.</p>
        </div>
        <Link to="/" className="btn btn-secondary">Return to Portal</Link>
      </div>
    );
  }

  // Check window open
  const isWindowOpen = config
    ? new Date() >= new Date(config.nomination_start) && new Date() <= new Date(config.nomination_end)
    : false;

  const showForm = !nomination || isEditing;
  const isLocked = nomination && (
    nomination.status === 'approved' ||
    (nomination.status === 'rejected' && nomination.rejection_count >= 3) ||
    !isWindowOpen
  );

  return (
    <div style={{ flexGrow: 1 }}>
      <PhaseTracker />

      <header style={{ marginBottom: '2rem' }}>
        <h2 className="display-title" style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>
          File Candidacy
        </h2>
        <p className="muted-text" style={{ fontSize: '0.9rem' }}>
          State your case to the electorate as a Student Placement Representative.
        </p>
      </header>

      {error && (
        <div className="notice-box error" role="alert">
          <div className="notice-title">Error</div>
          <p style={{ fontSize: '0.9rem' }}>{error}</p>
        </div>
      )}

      {success && (
        <div className="notice-box success" role="status">
          <div className="notice-title">Recorded</div>
          <p style={{ fontSize: '0.9rem' }}>{success}</p>
        </div>
      )}

      {nomination && nomination.status === 'rejected' && (
        <div className="notice-box error" style={{ marginBottom: '1.5rem' }}>
          <div className="notice-title">Nomination Rejected (Attempt {nomination.rejection_count} of 3)</div>
          <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            Your candidacy nomination has been rejected by the administrator.
          </p>
          {nomination.rejection_reason && (
            <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', borderLeft: '3px solid var(--error-border)', backgroundColor: 'rgba(235, 94, 85, 0.05)', fontSize: '0.9rem' }}>
              <strong>Reason for Rejection:</strong> {nomination.rejection_reason}
            </div>
          )}
          {nomination.rejection_count < 3 ? (
            <p style={{ fontSize: '0.85rem', marginTop: '0.75rem', color: 'var(--ink)' }}>
              You have <strong>{3 - nomination.rejection_count}</strong> chances remaining to correct and re-submit your statement.
            </p>
          ) : (
            <p style={{ fontSize: '0.85rem', marginTop: '0.75rem', fontWeight: 'bold', color: 'var(--seal)' }}>
              You have reached the maximum limit of 3 rejections and are barred from submitting further candidacies.
            </p>
          )}
        </div>
      )}

      {!isWindowOpen && !nomination && (
        <div className="notice-box">
          <div className="notice-title">Nomination Closed</div>
          <p style={{ fontSize: '0.9rem' }}>
            The window for filing self-nominations is currently closed. Refer to the timeline on the dashboard.
          </p>
        </div>
      )}

      {showForm && isWindowOpen ? (
        <form onSubmit={handleSubmit} style={{ border: '1px solid var(--ink)', padding: '2rem 1.5rem', marginBottom: '2.5rem' }}>
          <div className="form-group">
            <label htmlFor="statement-input">Manifesto / Candidacy Statement</label>
            <textarea
              id="statement-input"
              className="input-field"
              placeholder="State your objectives, credentials, and vision for placement coordination in 600 characters or less."
              maxLength={maxChars}
              value={statement}
              onChange={(e) => handleStatementChange(e.target.value)}
              disabled={submitting}
              required
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem' }}>
              <span className="muted-text" style={{ fontSize: '0.75rem' }}>
                Ensure statement is concise and factual.
              </span>
              <span className="mono-data" style={{ fontSize: '0.8rem', fontWeight: 600, color: statement.length > maxChars - 20 ? 'var(--seal)' : 'var(--ink)' }}>
                {statement.length} / {maxChars}
              </span>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="photo-file">Candidate Photo (Optional)</label>
            <input
              id="photo-file"
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
              disabled={submitting}
              style={{ display: 'block', margin: '0.5rem 0' }}
            />
            {uploadProgress && (
              <span className="mono-data" style={{ fontSize: '0.75rem', display: 'block', margin: '0.2rem 0' }}>
                {uploadProgress}
              </span>
            )}
            
            <label htmlFor="photo-url-input" style={{ fontSize: '0.75rem', marginTop: '0.75rem', textTransform: 'none' }}>
              Or enter direct image URL:
            </label>
            <input
              id="photo-url-input"
              className="input-field mono"
              type="url"
              placeholder="https://example.com/photo.jpg"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              disabled={submitting}
            />
          </div>

          {photoUrl && (
            <div style={{ marginBottom: '1.5rem' }}>
              <span className="muted-text" style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>
                Image Preview:
              </span>
              <img src={photoUrl} alt="Preview" className="candidate-photo-preview" />
            </div>
          )}

          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? 'Submitting...' : nomination ? 'Save Changes' : 'Submit nomination'}
            </button>

            {nomination && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setStatement(nomination.statement);
                  setPhotoUrl(nomination.photo_url || '');
                  setIsEditing(false);
                  setError(null);
                }}
                disabled={submitting}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        nomination && (
          <div style={{ border: '1px solid var(--ink)', padding: '2rem 1.5rem', marginBottom: '2.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--register)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <span className="app-subbranding" style={{ fontSize: '0.75rem' }}>Candidate Roll</span>
                <div className="mono-data" style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.2rem' }}>
                  {nomination.candidate_roll_no}
                </div>
              </div>
              <div>
                <span className="muted-text" style={{ fontSize: '0.75rem', display: 'block', textAlign: 'right' }}>Status</span>
                <span className={`status-pill ${nomination.status}`} style={{ marginTop: '0.25rem' }}>
                  {nomination.status}
                </span>
              </div>
            </div>

            {nomination.photo_url && (
              <div style={{ marginBottom: '1.5rem' }}>
                <img src={nomination.photo_url} alt={student?.name || ''} className="candidate-photo-preview" />
              </div>
            )}

            <div style={{ marginBottom: '2rem' }}>
              <span className="muted-text" style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.5rem' }}>
                Manifesto Statement
              </span>
              <p style={{ whiteSpace: 'pre-wrap', padding: '1rem', borderLeft: '3px solid var(--ink)', backgroundColor: '#fcfcfb' }}>
                {nomination.statement}
              </p>
            </div>

            <div style={{ borderTop: '1px solid var(--register)', paddingTop: '1.5rem', display: 'flex', justifyItems: 'center', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted-text" style={{ fontSize: '0.75rem' }}>
                Submitted: <span className="mono-data">{new Date(nomination.submitted_at).toLocaleString()}</span>
              </span>

              {isWindowOpen && (nomination.status === 'pending' || (nomination.status === 'rejected' && nomination.rejection_count < 3)) ? (
                <button className="btn" onClick={() => setIsEditing(true)}>
                  Edit Statement
                </button>
              ) : (
                <span className="muted-text" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                  {isLocked ? 'Candidacy Locked' : 'Window Closed'}
                </span>
              )}
            </div>
          </div>
        )
      )}

      <div>
        <Link to="/" className="btn btn-secondary">
          Return to Dashboard
        </Link>
      </div>

    </div>
  );
};
export default Nominate;
