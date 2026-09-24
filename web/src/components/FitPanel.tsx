import type { BodyMeasurements, SizeRecommendation } from '@shared/fit/measure';
import type { WebGarment } from '../catalog';

interface Props {
  garment: WebGarment;
  measurements: BodyMeasurements;
  recommendation: SizeRecommendation | null;
  heightCm: number;
  fitTrim: number;
  onHeightChange: (cm: number) => void;
  onTrimChange: (trim: number) => void;
}

export function FitPanel({
  garment,
  measurements,
  recommendation,
  heightCm,
  fitTrim,
  onHeightChange,
  onTrimChange,
}: Props) {
  return (
    <section className="panel" aria-label="Fit and sizing">
      <header className="panel-head">
        <h2>{garment.name}</h2>
        <p className="muted">
          {garment.brand} &middot; {garment.colorway}
        </p>
      </header>

      {recommendation ? (
        <div className="size-card">
          <div>
            <span className="label">RECOMMENDED</span>
            <strong className="size">{recommendation.size.label}</strong>
          </div>
          <div>
            <p>{recommendation.note}</p>
            {measurements.quality !== 'unavailable' ? (
              <p className="muted small">
                Shoulders ~{measurements.shoulderCm.toFixed(0)}cm &middot; chest ~
                {measurements.chestCm.toFixed(0)}cm
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="size-card">
          <p>Step back until your shoulders and hips are in frame to get a size.</p>
        </div>
      )}

      <label className="slider">
        <span className="label">YOUR HEIGHT</span>
        <input
          type="range"
          min={140}
          max={210}
          step={1}
          value={heightCm}
          onChange={(e) => onHeightChange(Number(e.target.value))}
        />
        <output>{heightCm} cm</output>
      </label>

      <label className="slider">
        <span className="label">FIT</span>
        <input
          type="range"
          min={0.8}
          max={1.2}
          step={0.01}
          value={fitTrim}
          onChange={(e) => onTrimChange(Number(e.target.value))}
        />
        <output>
          {fitTrim === 1 ? 'As cut' : `${fitTrim > 1 ? '+' : ''}${Math.round((fitTrim - 1) * 100)}%`}
        </output>
      </label>

      <p className="muted small">
        Sizes are estimated from one camera and your stated height. A starting
        point, not a tailor&rsquo;s tape.
      </p>
    </section>
  );
}
