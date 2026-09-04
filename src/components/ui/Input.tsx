/**
 * Input / SearchInput / Select — champs sur la base `.field`.
 * Input et SearchInput transfèrent leur `ref` à l'`<input>`
 * (utile pour focus() programmatique, ex. raccourci Ctrl+K).
 */
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Densité du champ. `sm` sert aux zones contraintes (sidebars, barres d'outils). */
export type FieldSize = 'sm' | 'md';

// `md` reprend exactement les classes d'origine (la taille de texte vient
// de `.field`) : seul `sm` introduit une densité réduite.
const FIELD_SIZES: Record<FieldSize, { base: string; withIcon: string; icon: number }> = {
  sm: { base: 'h-8 px-2.5 text-xs', withIcon: 'h-8 pl-7 pr-2.5 text-xs', icon: 13 },
  md: { base: 'h-9 px-3', withIcon: 'h-9 pl-8 pr-3', icon: 15 },
};

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  inputSize?: FieldSize;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, className, inputSize = 'md', ...rest },
  ref,
) {
  const sizing = FIELD_SIZES[inputSize];
  if (icon !== undefined) {
    return (
      <span className={cn('relative flex items-center', className)}>
        <span
          className={cn(
            'pointer-events-none absolute text-zinc-400 dark:text-zinc-500',
            inputSize === 'sm' ? 'left-2' : 'left-2.5',
          )}
        >
          {icon}
        </span>
        <input ref={ref} className={cn('field w-full', sizing.withIcon)} {...rest} />
      </span>
    );
  }
  return <input ref={ref} className={cn('field w-full', sizing.base, className)} {...rest} />;
});

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputSize?: FieldSize;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    { value, onChange, placeholder = 'Rechercher…', className, inputSize = 'md', ...rest },
    ref,
  ) {
    return (
      <Input
        ref={ref}
        // L'icône suit la densité du champ, sinon elle paraît
        // disproportionnée en taille `sm`.
        icon={<Search size={FIELD_SIZES[inputSize].icon} />}
        inputSize={inputSize}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
        {...rest}
      />
    );
  },
);

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string }>;
  selectSize?: FieldSize;
}

export function Select({ options, className, selectSize = 'md', ...rest }: SelectProps) {
  return (
    <select
      className={cn(
        'field',
        selectSize === 'sm' ? 'h-8 px-2 pr-6 text-xs' : 'h-9 px-2.5 pr-8',
        className,
      )}
      {...rest}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
