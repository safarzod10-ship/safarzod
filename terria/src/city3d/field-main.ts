/** Stand-alone preview of the 3D city field (field.html): grass, camera, grid. */
import { FieldView } from './FieldView.ts';

const q = new URLSearchParams(location.search);
const view = new FieldView(document.getElementById('field')!, {
  size: Number(q.get('size') ?? 44),
  pitch: Number(q.get('pitch') ?? 42),
});
(window as unknown as { __field: FieldView }).__field = view;

const pitch = document.getElementById('pitch') as HTMLInputElement;
const pv = document.getElementById('pv')!;
pitch.value = String(q.get('pitch') ?? 42);
pitch.addEventListener('input', () => {
  view.setAngles(Number(pitch.value));
  pv.textContent = pitch.value + '°';
});
const grid = document.getElementById('grid') as HTMLInputElement;
grid.checked = q.has('grid');
const applyGrid = (): void => {
  view.grass.uGrid.value = grid.checked ? 1 : 0;
};
grid.addEventListener('change', applyGrid);
applyGrid();
// the grid follows the pointer like around a building being placed
view.renderer.domElement.addEventListener('pointermove', (e) => {
  const p = view.groundAt(e.clientX, e.clientY);
  if (p) view.grass.uGridC.value.set(p.x, p.z);
});
