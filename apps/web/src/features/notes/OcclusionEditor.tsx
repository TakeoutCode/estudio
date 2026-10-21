import type { OcclusionGroup, OcclusionRect } from '@estudio/shared';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { MediaImage } from '@/features/media';
import {
  addRect,
  type DrawTarget,
  KEY_STEP,
  moveBy,
  type RectRef,
  rectBetween,
  removeRect,
  resizeBy,
  updateRect,
} from './occlusion-edit';

/** La imagen sobre la que se dibuja: una ya guardada, o la que ella acaba de elegir. */
export type EditorPicture =
  | { readonly kind: 'asset'; readonly assetId: string; readonly alt: string }
  | { readonly kind: 'file'; readonly url: string; readonly width: number; readonly height: number };

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const field = `w-full rounded-(--radius-card) border border-muted/40 bg-bg px-4 py-2 text-text ${focus}`;
const choiceButton = `min-h-11 rounded-(--radius-card) border px-3 text-text ${focus}`;

/** En el editor la imagen ocupa el ancho de la pantalla (390 px en el iPhone, UX2). */
const EDITOR_IMAGE_WIDTH = 600;

const place = (r: OcclusionRect): CSSProperties => ({
  left: `${String(r.x * 100)}%`,
  top: `${String(r.y * 100)}%`,
  width: `${String(r.w * 100)}%`,
  height: `${String(r.h * 100)}%`,
});

type Gesture =
  | { readonly kind: 'draw'; readonly start: Point }
  | {
      readonly kind: 'move' | 'resize';
      readonly ref: RectRef;
      readonly start: Point;
      readonly origin: OcclusionRect;
    };

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * LD §1, R10: tapar las etiquetas de una imagen. Con "Dibujar", arrastrar sobre la imagen crea
 * un recuadro (UX2: sin "Dibujar" la página se desplaza normal); arrastrar un recuadro lo mueve
 * y su esquina lo agranda. Con teclado: "Agregar recuadro", flechas para mover, Mayús + flechas
 * para el tamaño y Suprimir para quitarlo. Cada etiqueta es una Card.
 */
export function OcclusionEditor({
  picture,
  groups,
  onGroups,
}: {
  readonly picture: EditorPicture;
  readonly groups: readonly OcclusionGroup[];
  readonly onGroups: (groups: OcclusionGroup[]) => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [drawing, setDrawing] = useState(groups.length === 0);
  const [draft, setDraft] = useState<OcclusionRect | null>(null);
  const [selected, setSelected] = useState<RectRef | null>(null);
  const [target, setTarget] = useState<DrawTarget>('new');
  const sorted = [...groups].sort((a, b) => a.n - b.n);
  const position = (n: number) => sorted.findIndex((g) => g.n === n) + 1;
  const drawTarget = target !== 'new' && !groups.some((g) => g.n === target) ? 'new' : target;

  const toPoint = (event: PointerEvent): Point => {
    const box = surface.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };
  const capture = (event: PointerEvent) => {
    surface.current?.setPointerCapture(event.pointerId);
  };
  const add = (rect?: OcclusionRect) => {
    const result = addRect(groups, drawTarget, rect);
    if (!result) return;
    onGroups(result.groups);
    setSelected(result.selected);
  };
  const startOn = (event: PointerEvent, ref: RectRef, kind: 'move' | 'resize') => {
    const rect = groups.find((g) => g.n === ref.n)?.rects[ref.index];
    if (!rect) return;
    event.stopPropagation();
    capture(event);
    setSelected(ref);
    gesture.current = { kind, ref, start: toPoint(event), origin: rect };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawing || event.target !== event.currentTarget) return;
    capture(event);
    gesture.current = { kind: 'draw', start: toPoint(event) };
    setDraft(null);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current) return;
    const p = toPoint(event);
    if (current.kind === 'draw') {
      setDraft(rectBetween(current.start, p));
      return;
    }
    const dx = p.x - current.start.x;
    const dy = p.y - current.start.y;
    onGroups(
      updateRect(groups, current.ref, () =>
        current.kind === 'move' ? moveBy(current.origin, dx, dy) : resizeBy(current.origin, dx, dy),
      ),
    );
  };
  const onPointerEnd = () => {
    if (gesture.current?.kind === 'draw' && draft) add(draft);
    gesture.current = null;
    setDraft(null);
  };

  const onRectKey = (event: KeyboardEvent, ref: RectRef) => {
    const arrows: Record<string, Point> = {
      ArrowLeft: { x: -KEY_STEP, y: 0 },
      ArrowRight: { x: KEY_STEP, y: 0 },
      ArrowUp: { x: 0, y: -KEY_STEP },
      ArrowDown: { x: 0, y: KEY_STEP },
    };
    const step = arrows[event.key];
    if (step) {
      event.preventDefault();
      onGroups(
        updateRect(groups, ref, (r) =>
          event.shiftKey ? resizeBy(r, step.x, step.y) : moveBy(r, step.x, step.y),
        ),
      );
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onGroups(removeRect(groups, ref));
      setSelected(null);
    }
  };

  const overlay = (
    <div
      ref={surface}
      role="group"
      aria-label={t('notes.occlusion.canvasLabel')}
      aria-describedby={`${ids}-how`}
      className={`absolute inset-0 ${drawing ? 'cursor-crosshair' : ''}`}
      // UX2: solo mientras dibuja, el arrastre no desplaza la página.
      style={{ touchAction: drawing ? 'none' : 'manipulation' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {sorted.map((group) =>
        group.rects.map((rect, index) => {
          const ref = { n: group.n, index };
          const isSelected = selected?.n === group.n && selected.index === index;
          const inGroup = selected?.n === group.n;
          return (
            <button
              key={`${String(group.n)}-${String(index)}`}
              type="button"
              aria-label={t('notes.occlusion.rectName', { position: position(group.n) })}
              aria-pressed={isSelected}
              className={`absolute flex items-center justify-center rounded-sm text-caption font-semibold text-primary-contrast ${inGroup ? 'bg-primary' : 'bg-primary/70'} ${isSelected ? 'outline-2 outline-offset-1 outline-text' : ''} ${focus}`}
              style={{ ...place(rect), touchAction: 'none' }}
              onPointerDown={(event) => {
                startOn(event, ref, 'move');
              }}
              onClick={() => {
                setSelected(ref);
              }}
              onKeyDown={(event) => {
                onRectKey(event, ref);
              }}
            >
              {position(group.n)}
              {isSelected ? (
                // Esquina para agrandar: el área táctil es más grande que el punto que se ve.
                <span
                  aria-hidden
                  className="absolute -right-3 -bottom-3 flex size-6 items-center justify-center"
                  style={{ touchAction: 'none' }}
                  onPointerDown={(event) => {
                    startOn(event, ref, 'resize');
                  }}
                >
                  <span className="size-3 rounded-full border-2 border-primary-contrast bg-text" />
                </span>
              ) : null}
            </button>
          );
        }),
      )}
      {draft ? (
        <span
          aria-hidden
          className="absolute rounded-sm border-2 border-dashed border-primary"
          style={place(draft)}
        />
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <Picture picture={picture}>{overlay}</Picture>
      <p id={`${ids}-how`} className="m-0 text-caption text-muted">
        {t('notes.occlusion.instructions')}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={drawing}
          className={`${choiceButton} ${drawing ? 'border-primary bg-primary/20' : 'border-muted/40'}`}
          onClick={() => {
            setDrawing(!drawing);
          }}
        >
          {t('notes.occlusion.draw')}
        </button>
        <button
          type="button"
          className={`${choiceButton} border-muted/40`}
          onClick={() => {
            add();
          }}
        >
          {t('notes.occlusion.addRect')}
        </button>
        {selected ? (
          <button
            type="button"
            className={`${choiceButton} border-muted/40`}
            onClick={() => {
              onGroups(removeRect(groups, selected));
              setSelected(null);
            }}
          >
            {t('notes.occlusion.removeRect')}
          </button>
        ) : null}
      </div>
      {sorted.length > 0 ? (
        <label className="flex flex-col gap-1">
          <span>{t('notes.occlusion.target')}</span>
          <select
            className={field + ' min-h-11'}
            value={drawTarget === 'new' ? 'new' : String(drawTarget)}
            onChange={(event) => {
              setTarget(event.target.value === 'new' ? 'new' : Number(event.target.value));
            }}
          >
            <option value="new">{t('notes.occlusion.targetNew')}</option>
            {sorted.map((group) => (
              <option key={group.n} value={String(group.n)}>
                {t('notes.occlusion.targetExisting', { position: position(group.n) })}
                {group.label.trim() ? ` · ${group.label.trim()}` : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1">{t('notes.occlusion.groupsLegend')}</legend>
        {sorted.length === 0 ? (
          <p className="m-0 text-caption text-muted">{t('notes.occlusion.empty')}</p>
        ) : (
          sorted.map((group) => {
            const at = position(group.n);
            return (
              <div key={group.n} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`flex size-8 shrink-0 items-center justify-center rounded-sm text-caption font-semibold text-primary-contrast ${selected?.n === group.n ? 'bg-primary' : 'bg-primary/70'}`}
                >
                  {at}
                </span>
                <input
                  aria-label={t('notes.occlusion.groupLabel', { position: at })}
                  aria-describedby={`${ids}-rects-${String(group.n)}`}
                  className={field + ' min-h-11'}
                  maxLength={200}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={group.label}
                  onFocus={() => {
                    setSelected({ n: group.n, index: 0 });
                  }}
                  onChange={(event) => {
                    onGroups(groups.map((g) => (g.n === group.n ? { ...g, label: event.target.value } : g)));
                  }}
                />
                <span id={`${ids}-rects-${String(group.n)}`} className="sr-only">
                  {t('notes.occlusion.groupRects', { count: group.rects.length })}
                </span>
                <button
                  type="button"
                  className={`min-h-11 min-w-11 shrink-0 text-primary ${focus}`}
                  aria-label={t('notes.occlusion.removeGroup', { position: at })}
                  onClick={() => {
                    onGroups(groups.filter((g) => g.n !== group.n));
                    if (selected?.n === group.n) setSelected(null);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })
        )}
        <p className="m-0 text-caption text-muted">{t('notes.occlusion.count', { count: sorted.length })}</p>
      </fieldset>
    </div>
  );
}

/** La caja con la proporción de la imagen; lo que va encima se ubica en 0-1 (UX5: sin filtros). */
function Picture({ picture, children }: { readonly picture: EditorPicture; readonly children: ReactNode }) {
  if (picture.kind === 'asset') {
    return (
      <MediaImage assetId={picture.assetId} alt={picture.alt} cssWidth={EDITOR_IMAGE_WIDTH} eager>
        {children}
      </MediaImage>
    );
  }
  return (
    <div
      className="relative w-full overflow-hidden rounded-(--radius-card) border border-muted/40 bg-surface select-none"
      style={{ aspectRatio: `${String(picture.width)} / ${String(picture.height)}` }}
    >
      <img
        src={picture.url}
        alt=""
        width={picture.width}
        height={picture.height}
        draggable={false}
        className="absolute inset-0 size-full object-contain"
      />
      {children}
    </div>
  );
}
