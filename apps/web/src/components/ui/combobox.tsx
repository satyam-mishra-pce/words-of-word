import { InputHTMLAttributes, useEffect, useRef, useState } from 'react';
import { cn } from '../../utils/cn';

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
}

export function Combobox({ options, value, onChange, className, placeholder, ...props }: ComboboxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? '';
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div className={cn('ui-combobox', className)} ref={wrapRef}>
      <input
        className="ui-input"
        value={open ? query : selectedLabel}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        {...props}
      />
      {open && filtered.length > 0 && (
        <div className="ui-combobox-list">
          {filtered.map((option) => (
            <div
              key={option.value}
              className={cn('ui-combobox-option', option.value === value && 'ui-combobox-option-active')}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(option.value);
                setOpen(false);
                setQuery('');
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
