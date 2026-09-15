type IconProps = { className?: string };

function base(paths: React.ReactNode, className?: string) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths}
    </svg>
  );
}

export function ProfileIcon({ className }: IconProps) {
  return base(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>, className);
}
export function ExperienceIcon({ className }: IconProps) {
  return base(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></>, className);
}
export function EducationIcon({ className }: IconProps) {
  return base(<><path d="M12 3 2 8l10 5 10-5-10-5Z" /><path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5" /></>, className);
}
export function CertificationIcon({ className }: IconProps) {
  return base(<><circle cx="12" cy="9" r="6" /><path d="m8.5 14-1.5 7 5-2.5 5 2.5-1.5-7" /></>, className);
}
export function ProjectIcon({ className }: IconProps) {
  return base(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />, className);
}
export function LanguageIcon({ className }: IconProps) {
  return base(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.8 5.8 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.8-3.8-9S9.5 5.5 12 3Z" /></>, className);
}
export function SkillIcon({ className }: IconProps) {
  return base(<><path d="m14.7 6.3 3 3-8.4 8.4-4 1 1-4 8.4-8.4Z" /></>, className);
}
export function MailIcon({ className }: IconProps) {
  return base(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>, className);
}
export function PhoneIcon({ className }: IconProps) {
  return base(<path d="M6.6 10.8c1.2 2.4 3.2 4.4 5.6 5.6l1.9-1.9a1 1 0 0 1 1-.25c1.1.36 2.3.56 3.5.56a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.6 21 3 13.4 3 4a1 1 0 0 1 1-1h3.3a1 1 0 0 1 1 1c0 1.2.2 2.4.56 3.5a1 1 0 0 1-.25 1L6.6 10.8Z" />, className);
}
export function LocationIcon({ className }: IconProps) {
  return base(<><path d="M12 21s7-6.1 7-11a7 7 0 0 0-14 0c0 4.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></>, className);
}
export function LinkedInIcon({ className }: IconProps) {
  return base(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7.5 10v7M7.5 7.2v.1M12 17v-4.5c0-1.4 1-2.5 2.3-2.5s2.2 1.1 2.2 2.5V17" /></>, className);
}
export function GitHubIcon({ className }: IconProps) {
  return base(<path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.6-1.4-2.3-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.5-1.3.1-2.8 0 0 .9-.3 2.9 1a10 10 0 0 1 5.2 0c2-1.3 2.9-1 2.9-1 .6 1.5.2 2.5.1 2.8a3.9 3.9 0 0 1 1 2.7c0 3.9-2.3 4.7-4.6 5 .4.3.7 1 .7 2v3c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />, className);
}
