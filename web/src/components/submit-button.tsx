"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface SubmitButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "disabled"> {
  /** Shown instead of children, with the button disabled, while the parent form is submitting. */
  pendingLabel: string;
  children: ReactNode;
}

/** Pure idle/pending decision, extracted so it is directly testable without mocking React's form-submission lifecycle. */
export function submitButtonState(pending: boolean, pendingLabel: string, children: ReactNode): { label: ReactNode; disabled: boolean } {
  return { label: pending ? pendingLabel : children, disabled: pending };
}

/** A plain submit button that shows a pending label and disables itself while its parent <form> is submitting. No business logic - purely a useFormStatus presentation wrapper. */
export default function SubmitButton({ pendingLabel, children, ...rest }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const { label, disabled } = submitButtonState(pending, pendingLabel, children);
  return (
    <button type="submit" disabled={disabled} {...rest}>
      {label}
    </button>
  );
}
