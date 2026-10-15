import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { font, palette, radius, spacing } from '../theme';
import { useAccent } from '../store/AccentContext';

/* ---------- Card ---------- */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/* ---------- Section title ---------- */
export function SectionTitle({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <Text style={[styles.sectionTitle, style]}>{children}</Text>;
}

/* ---------- Text field ---------- */
interface FieldProps extends TextInputProps {
  label?: string;
  hint?: string;
}
export function TextField({ label, hint, style, ...rest }: FieldProps) {
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={palette.textFaint}
        style={[styles.field, style]}
        {...rest}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/* ---------- Button ---------- */
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { accent } = useAccent();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && { backgroundColor: accent },
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
        style,
      ]}
    >
      <Text
        style={[
          styles.btnText,
          variant === 'ghost' && styles.btnTextGhost,
          disabled && styles.btnTextDisabled,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/* ---------- Segmented control ---------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  style?: ViewStyle;
}) {
  const { accent } = useAccent();
  return (
    <View style={[styles.seg, style]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[styles.segItem, on && { backgroundColor: accent }]}
          >
            <Text style={[styles.segLabel, on && styles.segLabelOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- Chip ---------- */
export function Chip({
  label,
  selected,
  onPress,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  style?: ViewStyle;
}) {
  const { accent, accentSoft } = useAccent();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && { backgroundColor: accentSoft, borderColor: accent }, style]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

/* ---------- Stepper ---------- */
export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label?: string;
  suffix?: string;
}) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <View style={styles.stepperRow}>
      {label ? <Text style={styles.stepperLabel}>{label}</Text> : null}
      <View style={styles.stepper}>
        <Pressable onPress={dec} style={styles.stepBtn}>
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>
          {value}
          {suffix || ''}
        </Text>
        <Pressable onPress={inc} style={styles.stepBtn}>
          <Text style={styles.stepBtnText}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ---------- Color swatches ---------- */
export function SwatchRow({
  colors,
  value,
  onChange,
}: {
  colors: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <View style={styles.swatchRow}>
      {colors.map((c) => {
        const on = c === value;
        return (
          <Pressable key={c} onPress={() => onChange(c)} style={[styles.swatch, { backgroundColor: c }, on && styles.swatchOn]}>
            {on ? <Text style={styles.swatchCheck}>✓</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- Row helper ---------- */
export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: spacing.lg,
  },
  sectionTitle: {
    color: palette.text,
    fontSize: font.h3,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  fieldWrap: { marginBottom: spacing.md },
  fieldLabel: {
    color: palette.textDim,
    fontSize: font.small,
    marginBottom: spacing.xs,
  },
  field: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: palette.text,
    fontSize: font.body,
  },
  fieldHint: {
    color: palette.textFaint,
    fontSize: font.tiny,
    marginTop: spacing.xs,
  },
  btn: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** 主按钮底色由 useAccent() 内联给出（强调色可配置，不能固化在 StyleSheet 里） */
  btnGhost: { backgroundColor: palette.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
  btnDanger: { backgroundColor: 'rgba(244,63,94,0.18)' },
  btnDisabled: { opacity: 0.4 },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  btnText: { color: '#fff', fontSize: font.body, fontWeight: '600' },
  btnTextGhost: { color: palette.text },
  btnTextDisabled: { color: palette.textDim },
  seg: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: 3,
  },
  segItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.sm },
  segLabel: { color: palette.textDim, fontSize: font.small, fontWeight: '600' },
  segLabelOn: { color: '#fff' },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  chipLabel: { color: palette.textDim, fontSize: font.small },
  chipLabelOn: { color: palette.text },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperLabel: { color: palette.textDim, fontSize: font.body },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { color: palette.text, fontSize: 20, lineHeight: 22 },
  stepValue: {
    color: palette.text,
    fontSize: font.body,
    fontWeight: '600',
    minWidth: 52,
    textAlign: 'center',
  },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchOn: { borderWidth: 2, borderColor: '#fff' },
  swatchCheck: { color: '#fff', fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
