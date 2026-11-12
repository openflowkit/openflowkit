import type { SceneNode } from '../../domain/document/types';
import type { JsonObject } from '../../domain/document/json';
import { resolveNodeStyle, startingGradientColor, STYLE_LIMITS } from '../../domain/nodes/nodeStyle';
import { NumberField, Segmented } from '../design-system';
import { ChoiceRow, CustomColorSwatch, PanelRow, SwatchGrid } from './V2StyleControls';

// The style bar's Effects panel: a gradient over the fill, and the shadow with its own colour, opacity, blur and offset.

type GradientChoice = 'none' | 'south' | 'east' | 'radial';

const ignoreDraft = (): void => undefined;

/** One value when every node agrees, else null. */
function shared<T>(values: readonly T[]): T | null {
  const first = JSON.stringify(values[0]);
  return values.every((value) => JSON.stringify(value) === first) ? values[0]! : null;
}

export function V2NodeEffects({ nodes, draft, preview, apply }: {
  readonly nodes: readonly SceneNode[];
  readonly draft: JsonObject | null;
  readonly preview: (patch: JsonObject) => void;
  readonly apply: (patch: JsonObject) => void;
}): React.JSX.Element {
  const styles = nodes.map((node) => resolveNodeStyle(node));
  const fill = shared(styles.map((style) => style.fill));
  // A draft `shadow: true|false` wins over the resolved one while previewing; '' is a mixed selection.
  const shadows = styles.map((style) => style.shadow);
  const onOff = shared(shadows.map((value) => value !== null));
  const shadowSetting = typeof draft?.shadow === 'boolean' ? draft.shadow : onOff;
  const shadow = shadowSetting ? shared(shadows) : null;
  const gradients = styles.map((style) => style.gradient);
  const gradient = shared(gradients);
  const direction = shared(gradients.map((value) => value?.direction ?? 'none'));
  const gradientChoice = direction === 'none' || direction === 'south' || direction === 'east' || direction === 'radial' ? direction : null;
  return (<>
      <PanelRow label="Gradient">
        <ChoiceRow<GradientChoice> label="Gradient" value={gradientChoice}
          onChange={(value) => apply(value === 'none' ? { gradientColor: 'transparent' }
            : { gradientDirection: value, gradientColor: gradient?.color ?? startingGradientColor(fill) })}
          options={[{ value: 'none', label: 'None', title: 'No gradient' }, { value: 'south', label: '↓', title: 'Top to bottom' },
            { value: 'east', label: '→', title: 'Left to right' }, { value: 'radial', label: '◎', title: 'From the centre' }]} />
      </PanelRow>
      {gradient ? (
        <PanelRow label="Gradient to">
          <SwatchGrid label="Gradient colour" options={[]} selected={null} onPick={ignoreDraft}
            trailing={<CustomColorSwatch value={gradient.color}
              onChange={(hex) => preview({ gradientColor: hex })} onCommit={(hex) => apply({ gradientColor: hex })} />} />
        </PanelRow>
      ) : null}
      <PanelRow label="Shadow">
        <Segmented<'on' | 'off' | ''> label="Shadow" value={shadowSetting === null ? '' : shadowSetting ? 'on' : 'off'}
          onChange={(value) => apply({ shadow: value === 'on' })}
          options={[{ value: 'off', label: 'None' }, { value: 'on', label: 'Soft' }]} />
      </PanelRow>
      {shadow ? (<>
        <PanelRow label="Shadow colour">
          <SwatchGrid label="Shadow colour" options={[]} selected={null} onPick={ignoreDraft}
            trailing={<CustomColorSwatch value={shadow.color}
              onChange={(hex) => preview({ shadowColor: hex })} onCommit={(hex) => apply({ shadowColor: hex })} />} />
        </PanelRow>
        <PanelRow label="Shadow opacity">
          <NumberField stepper="stacked" label="Shadow opacity" hideLabel value={Math.round(shadow.opacity * 100)}
            min={0} max={100} step={5} unit="%"
            onChange={(value) => preview({ shadowOpacity: value / 100 })} onCommit={(value) => apply({ shadowOpacity: value / 100 })} />
        </PanelRow>
        <PanelRow label="Blur">
          <NumberField stepper="stacked" label="Shadow blur" hideLabel value={shadow.blur}
            min={STYLE_LIMITS.shadowBlur.min} max={STYLE_LIMITS.shadowBlur.max} step={0.5} unit="px"
            onChange={(value) => preview({ shadowBlur: value })} onCommit={(value) => apply({ shadowBlur: value })} />
        </PanelRow>
        <PanelRow label="Offset">
          <NumberField stepper="stacked" label="Shadow offset X" hideLabel value={shadow.offsetX}
            min={STYLE_LIMITS.shadowOffset.min} max={STYLE_LIMITS.shadowOffset.max} step={1} unit="x"
            onChange={(value) => preview({ shadowOffsetX: value })} onCommit={(value) => apply({ shadowOffsetX: value })} />
          <NumberField stepper="stacked" label="Shadow offset Y" hideLabel value={shadow.offsetY}
            min={STYLE_LIMITS.shadowOffset.min} max={STYLE_LIMITS.shadowOffset.max} step={1} unit="y"
            onChange={(value) => preview({ shadowOffsetY: value })} onCommit={(value) => apply({ shadowOffsetY: value })} />
        </PanelRow>
      </>) : null}
  </>);
}
