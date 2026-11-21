"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import {
  normalizeAddressSuggestion,
  storeAddressSuggestion,
} from "../../lib/address-suggestion";

// The hero's address field and Start building. A typed name only travels to
// the setup guide's Address step as a suggestion; sign-in comes first and
// nothing is checked or reserved here. Without JavaScript the form still
// opens sign-in.
export function AddressStart() {
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="address-start"
      action="/sign-in"
      method="get"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) {
          const name = normalizeAddressSuggestion(value);
          if (!name) {
            setInvalid(true);
            input.current?.focus();
            return;
          }
          storeAddressSuggestion(name);
        }
        router.push("/sign-in");
      }}
    >
      <div className="address-start-row">
        <label className="sr-only" htmlFor={id}>
          Your address name (optional)
        </label>
        <div className="address-start-field" data-invalid={invalid}>
          <input
            ref={input}
            id={id}
            value={value}
            placeholder="yourname"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={invalid}
            aria-describedby={`${id}-help`}
            onChange={(event) => {
              setValue(event.target.value);
              setInvalid(false);
            }}
          />
          <span aria-hidden="true">.hasaweb.site</span>
        </div>
        <button className="primary-button" type="submit">
          Start building
        </button>
      </div>
      <p id={`${id}-help`} className="address-start-help" aria-live="polite">
        {invalid
          ? "Use 3–30 lowercase letters, numbers or hyphens, with no hyphen at either end."
          : "Optional. After you sign in, setup checks the name and reserves it when you continue."}
      </p>
    </form>
  );
}
