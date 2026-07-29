export interface ReferenceMarkdownViolation {
  readonly message: string;
  readonly line: number;
}

interface Rule {
  readonly message: string;
  readonly pattern: RegExp;
}

const generalRules: readonly Rule[] = [
  {
    message: "Use the canonical Aoyosumu style spelling.",
    pattern: /\bAoyusumu\b/iu,
  },
  {
    message: "Use `Requirements:` as the canonical requirements field.",
    pattern: /^(?:Requirement\(s\)|Requirments):/imu,
  },
  {
    message: "Use `Requirements: None` instead of a blank requirements field.",
    pattern: /^Requirements:\s*$/imu,
  },
  {
    message: "Use `Requirements: None` instead of `Requirements: N/A`.",
    pattern: /^Requirements:\s*N\/A\s*$/imu,
  },
  {
    message: "Use `Description:` as the canonical description field.",
    pattern: /^Description of the Item:/imu,
  },
  {
    message: "Use `Location:` as the canonical location field.",
    pattern: /^Located:/imu,
  },
  {
    message: "Use `Defense Slots:` as the canonical ship field.",
    pattern: /^Defense slots:/mu,
  },
  {
    message: "Use `Dexterity:` as the canonical stat field.",
    pattern: /^Dexerity:/imu,
  },
];

const moveRules: readonly Rule[] = [
  {
    message: "Use Markdown move headings instead of BBCode list-entry markers.",
    pattern: /^\[\*\]/mu,
  },
];

const lineForOffset = (content: string, offset: number): number =>
  content.slice(0, offset).split("\n").length;

export const validateReferenceMarkdown = (
  content: string,
  options: { readonly isMoveDocument?: boolean } = {},
): readonly ReferenceMarkdownViolation[] =>
  [...generalRules, ...(options.isMoveDocument ? moveRules : [])].flatMap(
    ({ message, pattern }) => {
      const match = pattern.exec(content);
      return match === null ? [] : [{ message, line: lineForOffset(content, match.index) }];
    },
  );
