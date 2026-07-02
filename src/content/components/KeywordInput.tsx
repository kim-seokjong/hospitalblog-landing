'use client';

import { useState, useRef, type ReactNode } from 'react';
import type { WritingStyle, OptimizationMode, TargetSite, Readability } from '@/types';
import SpecialtyKeywordSuggester from '@/content/components/SpecialtyKeywordSuggester';

interface KeywordInputProps {
  onSubmit: (keyword: string, hospitalType: string, additionalInfo: string, writingStyle: WritingStyle, region: string, optimizationMode: OptimizationMode, targetSite: TargetSite, readability: Readability, useVoiceDna: boolean, viralHook: boolean, storytelling: boolean, reverseAnalysis: boolean) => void;
  isLoading: boolean;
  defaultKeyword?: string;
  defaultHospitalType?: string;
  defaultAdditionalInfo?: string;
  defaultWritingStyle?: WritingStyle;
  defaultOptimizationMode?: OptimizationMode;
  defaultTargetSite?: TargetSite;
  defaultReadability?: Readability;
  defaultUseVoiceDna?: boolean;
  defaultViralHook?: boolean;
  defaultStorytelling?: boolean;
  defaultReverseAnalysis?: boolean;
  lockedHospitalType?: string;
  defaultRegion?: string;
}

const HOSPITAL_TYPES = [
  '내과', '외과', '피부과', '성형외과', '정형외과', '안과',
  '이비인후과', '치과', '한의원', '산부인과', '소아과', '신경과',
  '정신건강의학과', '재활의학과', '가정의학과', '비뇨기과', '기타',
];

const WRITING_STYLES: { value: WritingStyle; label: string; desc: string; icon: string }[] = [
  { value: '전문가',  label: '전문가시점',  desc: '의학 전문성 강조', icon: '🩺' },
  { value: '고객이해', label: '고객이해시점', desc: '전문용어 없이',    icon: '👥' },
  { value: '사무장',  label: '사무장시점',  desc: '서비스·절차 중심', icon: '🏥' },
];

const OPTIMIZATION_MODES: { value: OptimizationMode; label: string; desc: string; icon: string }[] = [
  { value: 'seo+geo', label: 'SEO+GEO 최적화', desc: 'AI 검색 인용 최대화', icon: '🚀' },
  { value: 'seo',     label: 'SEO 최적화',     desc: 'AI티 없는 자연스런 글', icon: '🌿' },
];

const TARGET_SITES: { value: TargetSite; label: string; desc: string; icon: string }[] = [
  { value: 'naver',  label: '네이버 블로그', desc: '네이버 검색 최적화',    icon: '🟢' },
  { value: 'google', label: '구글',          desc: '구글·AI 검색 최적화', icon: '🔍' },
];

/** 공용 토글 행 (스위치 UI) — 아코디언 내부에서 사용 */
function ToggleRow({ icon, title, desc, value, onChange, disabled }: {
  icon: string; title: string; desc: string; value: boolean;
  onChange: (next: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      disabled={disabled}
      aria-pressed={value}
      className={`w-full flex items-center gap-3 py-3 px-3 sm:px-4 rounded-xl border-2 transition-all text-left ${
        value
          ? 'border-[#ff4628] bg-[#ffece7]'
          : 'border-[#b4bfce] bg-white hover:border-[#ff4628]/40 active:bg-[#eef2f6]'
      }`}
    >
      <span className="text-xl leading-none flex-shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12px] sm:text-[13px] font-bold leading-tight text-[#202020]">{title}</span>
        <span className="block text-[10px] sm:text-[11px] leading-snug text-[#5b6573] mt-0.5">{desc}</span>
      </span>
      <span className={`flex-shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${value ? 'bg-[#ff4628]' : 'bg-[#b4bfce]'}`}>
        <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`} />
      </span>
    </button>
  );
}

/** 접히는 설정 그룹 헤더 — 요약 배지로 현재 상태를 보여준다 */
function AccordionSection({ icon, title, summary, isDefault, open, onToggle, children }: {
  icon: string; title: string; summary: string; isDefault: boolean;
  open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className={`rounded-xl border-2 transition-colors ${open ? 'border-[#ff4628]/40' : 'border-[#e3e9f0]'}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 py-3 px-3 sm:px-4 text-left"
      >
        <span className="text-base leading-none flex-shrink-0">{icon}</span>
        <span className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-[12px] sm:text-[13px] font-bold text-[#202020]">{title}</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            isDefault ? 'bg-[#eef2f6] text-[#5b6573]' : 'bg-[#ffece7] text-[#ff4628]'
          }`}>
            {summary}
          </span>
        </span>
        <span className={`flex-shrink-0 text-[#5b6573] text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && <div className="px-3 sm:px-4 pb-3 space-y-2.5">{children}</div>}
    </div>
  );
}

export default function KeywordInput({ onSubmit, isLoading, defaultKeyword, defaultHospitalType, defaultAdditionalInfo, defaultWritingStyle, defaultOptimizationMode, defaultTargetSite, defaultReadability, defaultUseVoiceDna, defaultViralHook, defaultStorytelling, defaultReverseAnalysis, lockedHospitalType, defaultRegion }: KeywordInputProps) {
  const [keyword, setKeyword] = useState(defaultKeyword ?? '');
  const [hospitalType, setHospitalType] = useState(lockedHospitalType || defaultHospitalType || '피부과');
  const keywordInputRef = useRef<HTMLInputElement>(null);
  const [region, setRegion] = useState(defaultRegion ?? '');
  const [additionalInfo, setAdditionalInfo] = useState(defaultAdditionalInfo ?? '');
  const [writingStyle, setWritingStyle] = useState<WritingStyle>(defaultWritingStyle || '전문가');
  const [optimizationMode, setOptimizationMode] = useState<OptimizationMode>(defaultOptimizationMode || 'seo+geo');
  const [targetSite, setTargetSite] = useState<TargetSite>(defaultTargetSite || 'naver');
  // DUMBIFY 난이도 — 기본 ON('easy'). 끄면 'standard'
  const [readability, setReadability] = useState<Readability>(defaultReadability || 'easy');
  // VOICE-DNA 우리 병원 문체 적용 — 기본 ON. 명시적 false 일 때만 OFF
  const [useVoiceDna, setUseVoiceDna] = useState<boolean>(defaultUseVoiceDna !== false);
  // VIRAL-HOOKS·STORYTELLING — 의료광고법 리스크 선택 기능, 기본 OFF
  const [viralHook, setViralHook] = useState<boolean>(defaultViralHook === true);
  const [storytelling, setStorytelling] = useState<boolean>(defaultStorytelling === true);
  // 상위노출 역분석 — 상위 글 골격 반영, 기본 ON. 명시적 false 일 때만 OFF
  const [reverseAnalysis, setReverseAnalysis] = useState<boolean>(defaultReverseAnalysis !== false);

  // 아코디언 접기 상태 — 비기본값이 저장돼 있으면 처음부터 펼쳐서 보여준다(내 설정이 적용 중임을 인지)
  const [styleOpen, setStyleOpen] = useState<boolean>(defaultViralHook === true || defaultStorytelling === true);
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);

  // 요약 배지 계산
  const styleActive = [viralHook && '몰입형 도입', storytelling && '이야기 구조'].filter(Boolean) as string[];
  const styleSummary = styleActive.length > 0 ? styleActive.join(' · ') : '기본 (정보형)';
  const advancedChanged =
    (readability !== 'easy' ? 1 : 0) + (!useVoiceDna ? 1 : 0) + (!reverseAnalysis ? 1 : 0) +
    (optimizationMode !== 'seo+geo' ? 1 : 0) + (targetSite !== 'naver' ? 1 : 0);
  const advancedSummary = advancedChanged === 0 ? '권장 기본값' : `${advancedChanged}개 변경됨`;

  const effectiveHospitalType = lockedHospitalType || hospitalType;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) return;
    onSubmit(keyword.trim(), effectiveHospitalType, additionalInfo.trim(), writingStyle, region.trim(), optimizationMode, targetSite, readability, useVoiceDna, viralHook, storytelling, reverseAnalysis);
  };

  return (
    <div className="rounded-2xl border border-[#b4bfce] bg-white p-4 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 flex-shrink-0 rounded-xl bg-[#ffece7] border border-[#ff4628]/30 flex items-center justify-center">
          <span className="text-[#ff4628] font-bold text-sm">1</span>
        </div>
        <div>
          <h2 className="text-base font-bold text-[#202020]">키워드 입력</h2>
          <p className="text-xs text-[#5b6573]">블로그 주제 키워드를 입력하세요</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[#5b6573] mb-1.5">
            핵심 키워드 <span className="text-[#ff4628]">*</span>
          </label>
          <input
            ref={keywordInputRef}
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="예: 레이저 토닝, 보톡스, 도수치료"
            className="w-full px-4 py-3 rounded-xl bg-white border border-[#b4bfce] text-[#202020] placeholder-[#73808f] text-sm focus:outline-none focus:border-[#ff4628] focus:ring-1 focus:ring-[#ff4628]/30 transition-colors"
            disabled={isLoading}
            autoComplete="off"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#5b6573] mb-1.5 flex items-center gap-1.5">
            병원 유형
            {lockedHospitalType && <span className="text-[9px] bg-[#eef2f6] text-[#5b6573] px-1.5 py-0.5 rounded-full">🔒 가입 시 설정됨</span>}
          </label>
          {lockedHospitalType ? (
            <div className="w-full px-4 py-3 rounded-xl bg-[#eef2f6] border border-[#b4bfce] text-[#5b6573] text-sm cursor-not-allowed">
              {lockedHospitalType}
            </div>
          ) : (
            <select
              value={hospitalType}
              onChange={(e) => setHospitalType(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white border border-[#b4bfce] text-[#202020] text-sm focus:outline-none focus:border-[#ff4628] focus:ring-1 focus:ring-[#ff4628]/30 transition-colors"
              disabled={isLoading}
            >
              {HOSPITAL_TYPES.map((type) => (
                <option key={type} value={type} className="bg-white">{type}</option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#5b6573] mb-1.5">
            지역 <span className="text-[#73808f] font-normal">(선택 · 키워드 추천에 활용)</span>
          </label>
          <input
            type="text"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="예: 강남, 홍대, 분당"
            className="w-full px-4 py-3 rounded-xl bg-white border border-[#b4bfce] text-[#202020] placeholder-[#73808f] text-sm focus:outline-none focus:border-[#ff4628] focus:ring-1 focus:ring-[#ff4628]/30 transition-colors"
            disabled={isLoading}
            autoComplete="off"
          />
        </div>

        <SpecialtyKeywordSuggester
          specialty={effectiveHospitalType}
          region={region}
          onSelect={(kw, isSelected) => {
            if (isSelected) {
              setKeyword((prev) => prev ? `${prev}, ${kw}` : kw);
            } else {
              setKeyword((prev) => {
                const parts = prev.split(',').map(k => k.trim()).filter(k => k !== kw);
                return parts.join(', ');
              });
            }
            setTimeout(() => keywordInputRef.current?.focus(), 0);
          }}
        />

        <div>
          <label className="block text-xs font-semibold text-[#5b6573] mb-1.5">
            추가 정보 <span className="text-[#73808f] font-normal">(선택)</span>
          </label>
          <textarea
            value={additionalInfo}
            onChange={(e) => setAdditionalInfo(e.target.value)}
            placeholder="강조할 내용, 타겟 환자군, 주요 서비스 등"
            rows={2}
            className="w-full px-4 py-3 rounded-xl bg-white border border-[#b4bfce] text-[#202020] placeholder-[#73808f] text-sm focus:outline-none focus:border-[#ff4628] focus:ring-1 focus:ring-[#ff4628]/30 transition-colors resize-none"
            disabled={isLoading}
          />
        </div>

        {/* 글쓰기 말투 */}
        <div>
          <label className="block text-xs font-semibold text-[#5b6573] mb-2">글쓰기 말투</label>
          <div className="grid grid-cols-3 gap-2">
            {WRITING_STYLES.map((style) => (
              <button
                key={style.value}
                type="button"
                onClick={() => setWritingStyle(style.value)}
                disabled={isLoading}
                className={`flex flex-col items-center gap-1 py-3 px-1 rounded-xl border-2 transition-all text-center min-h-[72px] ${
                  writingStyle === style.value
                    ? 'border-[#ff4628] bg-[#ffece7] text-[#202020]'
                    : 'border-[#b4bfce] bg-white text-[#5b6573] hover:border-[#ff4628]/40 active:bg-[#eef2f6]'
                }`}
              >
                <span className="text-xl leading-none">{style.icon}</span>
                <span className="text-[11px] font-bold leading-tight">{style.label}</span>
                <span className="text-[9px] opacity-70 leading-tight hidden sm:block">{style.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ✨ 글 스타일 (선택 기능 — 접힘, 기본 OFF) */}
        <AccordionSection
          icon="✨"
          title="글 스타일"
          summary={styleSummary}
          isDefault={styleActive.length === 0}
          open={styleOpen}
          onToggle={() => setStyleOpen((v) => !v)}
        >
          <ToggleRow
            icon="🎬"
            title="몰입형 도입(후킹)"
            desc="첫 문장으로 끌어들이기 (과장·공포 없이, 의료광고법 우선)"
            value={viralHook}
            onChange={setViralHook}
            disabled={isLoading}
          />
          <ToggleRow
            icon="📖"
            title="이야기 구조"
            desc="증상→원인→관리 흐름 (환자 후기·사례 없이, 의료광고법 우선)"
            value={storytelling}
            onChange={setStorytelling}
            disabled={isLoading}
          />
        </AccordionSection>

        {/* ⚙️ 고급 설정 (기본값 권장 — 접힘) */}
        <AccordionSection
          icon="⚙️"
          title="고급 설정"
          summary={advancedSummary}
          isDefault={advancedChanged === 0}
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((v) => !v)}
        >
          <ToggleRow
            icon="🎓"
            title="쉽게 풀어쓰기"
            desc="중학생도 이해할 쉬운 말로 (전문성·신뢰감은 유지)"
            value={readability === 'easy'}
            onChange={(next) => setReadability(next ? 'easy' : 'standard')}
            disabled={isLoading}
          />
          <ToggleRow
            icon="🧬"
            title="우리 병원 문체 적용"
            desc="그동안 고쳐온 말투를 반영 (의료광고법·자연체 규칙은 항상 우선)"
            value={useVoiceDna}
            onChange={setUseVoiceDna}
            disabled={isLoading}
          />
          <ToggleRow
            icon="📊"
            title="상위노출 역분석"
            desc="상위 글 골격(분량·소제목·하위주제)을 분석해 목표 반영 (의료광고법 우선)"
            value={reverseAnalysis}
            onChange={setReverseAnalysis}
            disabled={isLoading}
          />

          {/* 문단 구성 (최적화 방식) */}
          <div>
            <label className="block text-xs font-semibold text-[#5b6573] mb-2 mt-1">문단 구성</label>
            <div className="grid grid-cols-2 gap-2">
              {OPTIMIZATION_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setOptimizationMode(mode.value)}
                  disabled={isLoading}
                  className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 transition-all text-center min-h-[72px] ${
                    optimizationMode === mode.value
                      ? 'border-[#ff4628] bg-[#ffece7] text-[#202020]'
                      : 'border-[#b4bfce] bg-white text-[#5b6573] hover:border-[#ff4628]/40 active:bg-[#eef2f6]'
                  }`}
                >
                  <span className="text-xl leading-none">{mode.icon}</span>
                  <span className="text-[11px] font-bold leading-tight">{mode.label}</span>
                  <span className="text-[9px] opacity-70 leading-tight">{mode.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 게시 사이트 */}
          <div>
            <label className="block text-xs font-semibold text-[#5b6573] mb-2 mt-1">게시 사이트</label>
            <div className="grid grid-cols-2 gap-2">
              {TARGET_SITES.map((site) => (
                <button
                  key={site.value}
                  type="button"
                  onClick={() => setTargetSite(site.value)}
                  disabled={isLoading}
                  className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 transition-all text-center min-h-[72px] ${
                    targetSite === site.value
                      ? 'border-[#ff4628] bg-[#ffece7] text-[#202020]'
                      : 'border-[#b4bfce] bg-white text-[#5b6573] hover:border-[#ff4628]/40 active:bg-[#eef2f6]'
                  }`}
                >
                  <span className="text-xl leading-none">{site.icon}</span>
                  <span className="text-[11px] font-bold leading-tight">{site.label}</span>
                  <span className="text-[9px] opacity-70 leading-tight">{site.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-[#73808f] pt-0.5">
            변경한 설정은 자동 저장되어 다음 글 생성에도 그대로 적용됩니다.
          </p>
        </AccordionSection>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-start gap-2">
            <span className="text-amber-500 text-sm flex-shrink-0">⚠️</span>
            <p className="text-[11px] font-semibold text-amber-700 leading-relaxed">
              의료법 제56조 금지어 필터링 자동 적용 (완치, 최고, 100% 등 금지)
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={!keyword.trim() || isLoading}
          className="w-full py-4 bg-[#ff4628] hover:bg-[#e63a1c] active:bg-[#e63a1c] disabled:bg-[#b4bfce] disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] min-h-[52px]"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              SEO 제목 생성 중...
            </>
          ) : (
            <><span>✨</span> SEO 최적화 제목 5개 생성</>
          )}
        </button>
      </form>
    </div>
  );
}
