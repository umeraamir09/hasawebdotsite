"use client";

import { useState } from "react";
import {
  Area,
  Button,
  Chip,
  Dialog,
  Field,
  FilterChip,
  IconButton,
  Popover,
  SectionRow,
  SegmentedControl,
  StatusPill,
  Toggle,
} from "../../../components/workbench";
import styles from "./page.module.css";

export function WorkbenchReview() {
  return (
    <main className={styles.review}>
      <Board scheme="light" />
      <Board scheme="dark" />
    </main>
  );
}

const FILTERS = ["All", "Animals", "Hands", "Seasonal"];

function Board({ scheme }: { scheme: "light" | "dark" }) {
  const [on, setOn] = useState(true);
  const [bio, setBio] = useState("Designer and developer in Lahore.");
  const [mode, setMode] = useState<"light" | "dark" | "system">("system");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState("Projects");
  const [skills, setSkills] = useState(["TypeScript", "Figma"]);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <section
      className={`workbench ${styles.board}`}
      data-wb-scheme={scheme}
      aria-label={scheme === "light" ? "Light" : "Dark"}
    >
      <div className={styles.row}>
        <Button kind="primary" icon="plus">
          Add section
        </Button>
        <Button kind="secondary">Preview</Button>
        <Button kind="ghost">Cancel</Button>
        <Button kind="danger">Remove</Button>
        <Button kind="primary" size="s">
          Save
        </Button>
        <Button disabled>Publish</Button>
      </div>
      <div className={styles.row}>
        <IconButton icon="more" label="More" />
        <IconButton icon="more" label="More" kind="secondary" />
        <IconButton icon="more" label="More" kind="raised" />
        <IconButton icon="more" label="More" kind="soft" />
        <Toggle aria-label="Face reveal" checked={on} onCheckedChange={setOn} />
        <Toggle
          aria-label="Show location"
          checked={!on}
          onCheckedChange={(next) => setOn(!next)}
        />
      </div>
      <div className={styles.row}>
        <StatusPill status="live">Live</StatusPill>
        <StatusPill status="draft">Draft</StatusPill>
        <StatusPill status="issue">2 issues</StatusPill>
        <StatusPill status="pending">Publishing</StatusPill>
        {skills.map((skill) => (
          <Chip
            key={skill}
            label={skill}
            onRemove={() =>
              setSkills((current) => current.filter((item) => item !== skill))
            }
          />
        ))}
      </div>
      <div className={styles.row}>
        {FILTERS.map((name) => (
          <FilterChip
            key={name}
            selected={filter === name}
            onClick={() => setFilter(name)}
          >
            {name}
          </FilterChip>
        ))}
      </div>
      <div className={styles.fields}>
        <Field label="Address" defaultValue="umroo" trail=".hasaweb.site" />
        <Field label="Website" lead="link" placeholder="https://" />
        <Field
          label="Email"
          defaultValue="umroo@"
          error="Enter a full email address"
        />
        <Area
          label="Bio"
          value={bio}
          maxLength={160}
          onChange={(event) => setBio(event.target.value)}
        />
      </div>
      <div className={styles.rows}>
        {["Profile", "Projects", "Contact"].map((name) => (
          <SectionRow
            key={name}
            name={name}
            icon="grid"
            meta={name === "Projects" ? 3 : undefined}
            issueLabel={name === "Contact" ? "Has an issue" : undefined}
            selected={selected === name}
            onClick={() => setSelected(name)}
          />
        ))}
      </div>
      <SegmentedControl
        label="Mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: "light", label: "Light", icon: "sun" },
          { value: "dark", label: "Dark", icon: "moon" },
          { value: "system", label: "System", icon: "monitor" },
        ]}
      />
      <div className={styles.row}>
        <SegmentedControl
          label="Preview size"
          size="s"
          value={device}
          onChange={setDevice}
          options={[
            { value: "desktop", label: "Desktop", icon: "monitor" },
            { value: "mobile", label: "Mobile", icon: "phone" },
          ]}
        />
        <Popover
          label="Publish"
          align="start"
          trigger={(props) => (
            <Button {...props} kind="primary">
              Publish
            </Button>
          )}
        >
          <div className={styles.row}>
            <StatusPill status="issue">1 issue</StatusPill>
          </div>
          <SectionRow name="Contact" icon="grid" issueLabel="Has an issue" />
          <Button kind="primary" disabled>
            Publish
          </Button>
        </Popover>
        <Button onClick={() => setDialogOpen(true)}>Decoration</Button>
        <Dialog
          open={dialogOpen}
          title="Decoration"
          onClose={() => setDialogOpen(false)}
        >
          <div className={styles.row}>
            {FILTERS.map((name) => (
              <FilterChip
                key={name}
                selected={filter === name}
                onClick={() => setFilter(name)}
              >
                {name}
              </FilterChip>
            ))}
          </div>
          <div className={styles.row}>
            <Button kind="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button kind="primary" onClick={() => setDialogOpen(false)}>
              Done
            </Button>
          </div>
        </Dialog>
      </div>
    </section>
  );
}
