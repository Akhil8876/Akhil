import { formatPrice, type WebGarment } from '../catalog';

interface Props {
  garments: WebGarment[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function GarmentRail({ garments, activeId, onSelect }: Props) {
  return (
    <div className="rail" role="listbox" aria-label="Garments">
      {garments.map((garment) => (
        <button
          key={garment.id}
          type="button"
          role="option"
          aria-selected={garment.id === activeId}
          className={`rail-card${garment.id === activeId ? ' is-active' : ''}`}
          onClick={() => onSelect(garment.id)}
        >
          <img src={garment.imageUrl} alt="" width={72} height={72} />
          <span className="rail-name">{garment.colorway}</span>
          <span className="rail-price">{formatPrice(garment.priceCents)}</span>
        </button>
      ))}
    </div>
  );
}
