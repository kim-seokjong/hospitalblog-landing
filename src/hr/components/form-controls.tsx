'use client';

/**
 * 마이페이지·설정 공용 폼 컨트롤 모음 (인사팀 소관).
 * 기존 /settings/profile 페이지의 내부 컴포넌트를 재사용 가능하게 추출.
 *
 * 주의: input/select는 흰 글자 회귀 버그 이력이 있어
 * 명시적 text-white + placeholder-gray-500 을 반드시 유지할 것.
 */

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#b4bfce] rounded-xl p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <h2 className="text-sm font-semibold text-[#202020] mb-4 pb-3 border-b border-[#b4bfce]">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-[#4a4f55] mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-white border border-[#b4bfce] rounded-lg px-3 py-2.5 text-[#202020] text-sm placeholder-[#5b6573] focus:outline-none focus:border-[#ff4628] transition-colors"
    />
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-white border border-[#b4bfce] rounded-lg px-3 py-2.5 text-[#202020] text-sm focus:outline-none focus:border-[#ff4628] transition-colors appearance-none"
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value} className="bg-white text-[#202020]">
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm text-[#202020] font-medium">{label}</div>
        <div className="text-xs text-[#5b6573] mt-0.5">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-200 focus:outline-none ${
          checked ? 'bg-[#ff4628]' : 'bg-[#b4bfce]'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 mt-0.5 ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
