import React from 'react';
import { useElection } from '../contexts/ElectionContext';
import { useAuth } from '../contexts/AuthContext';
import { Link, useLocation } from 'react-router-dom';

export const PhaseTracker: React.FC = () => {
  const { currentPhase } = useElection();
  const { student } = useAuth();
  const location = useLocation();

  const rawPhases = [
    { key: 'nomination', label: 'Nominations' },
    { key: 'review', label: 'Review' },
    { key: 'voting', label: 'Voting' },
    { key: 'results', label: 'Results' }
  ];

  // Filter phases: admins don't see nominations; normal users don't see review
  const phases = rawPhases.filter(phase => {
    if (student?.is_admin) {
      return phase.key !== 'nomination';
    } else {
      return phase.key !== 'review';
    }
  });

  const getIsActive = (phaseKey: string) => {
    const path = location.pathname;
    if (path === '/nominate') return phaseKey === 'nomination';
    if (path === '/vote') return phaseKey === 'voting';
    if (path === '/results') return phaseKey === 'results';
    if (path === '/admin') return phaseKey === 'review';
    return phaseKey === currentPhase;
  };

  const getPhaseIndex = (phase: string) => {
    switch (phase) {
      case 'nomination': return 0;
      case 'review': return 1;
      case 'voting': return 2;
      case 'results': return 3;
      default: return 0;
    }
  };

  const currentPhaseIdx = getPhaseIndex(currentPhase);

  const getPhaseLink = (phaseKey: string) => {
    switch (phaseKey) {
      case 'nomination': return '/nominate';
      case 'review': return student?.is_admin ? '/admin' : '/';
      case 'voting': return '/vote';
      case 'results': return '/results';
      default: return '/';
    }
  };

  const getIsClickable = (_phaseKey: string, phaseIdxInOriginal: number) => {
    if (student?.is_admin) {
      // Admins can click Review, Voting, and Results (anything but nomination which is filtered out anyway)
      return true;
    } else {
      // Normal voters can click Nominations (idx 0), Voting (idx 2, if active/past), and Results (idx 3, if active)
      return phaseIdxInOriginal <= currentPhaseIdx;
    }
  };

  return (
    <div className="phase-tracker" aria-label="Election Phase Progress">
      {phases.map((phase, idx) => {
        const isActive = getIsActive(phase.key);
        const originalIdx = getPhaseIndex(phase.key);
        const isClickable = getIsClickable(phase.key, originalIdx);
        const linkTarget = getPhaseLink(phase.key);

        if (isClickable) {
          return (
            <Link
              key={phase.key}
              to={linkTarget}
              className={`phase-step clickable ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'step' : undefined}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <span className="step-number">{idx + 1}.</span>
              <span className="step-label">{phase.label}</span>
            </Link>
          );
        }

        return (
          <div
            key={phase.key}
            className={`phase-step ${isActive ? 'active' : ''}`}
            aria-current={isActive ? 'step' : undefined}
          >
            <span className="step-number">{idx + 1}.</span>
            <span className="step-label">{phase.label}</span>
          </div>
        );
      })}
    </div>
  );
};
export default PhaseTracker;
