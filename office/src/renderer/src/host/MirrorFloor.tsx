import { OfficeFloor } from '@/scene/office/OfficeFloor';

/**
 * The Office floor as Anything's window background: only the floor, with
 * its state copied from the app's main Office frame (`buzzHost` mirror role).
 * It runs none of the Office's own work (the hive, deliveries, terminals), so
 * a second copy never doubles anything; it only draws.
 */
export function MirrorFloor() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <OfficeFloor />
    </div>
  );
}
