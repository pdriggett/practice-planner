import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	normalizePath,
} from "obsidian";

type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface PracticePlannerSettings {
	folderPath: string;
	weekStartDay: DayIndex;
	skills: string[];
	skillHistory: string[];
}

const DEFAULT_SETTINGS: PracticePlannerSettings = {
	folderPath: "Practice",
	weekStartDay: 1,
	skills: ["Scales", "Technique", "Repertoire", "Sight Reading"],
	skillHistory: [],
};

const DAY_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default class PracticePlannerPlugin extends Plugin {
	settings: PracticePlannerSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();

		// Seed history from the currently active skills so existing setups
		// immediately have something to autocomplete.
		this.recordSkills(this.settings.skills);

		this.addCommand({
			id: "open-this-week",
			name: "Open this week's practice plan",
			callback: () => this.openWeek(0),
		});

		this.addCommand({
			id: "open-next-week",
			name: "Open next week's practice plan",
			callback: () => this.openWeek(1),
		});

		this.addCommand({
			id: "open-previous-week",
			name: "Open previous week's practice plan",
			callback: () => this.openWeek(-1),
		});

		this.addCommand({
			id: "rebuild-skill-history",
			name: "Rebuild skill history from notes",
			callback: async () => {
				const found = await this.scanVaultForSkills();
				new Notice(
					`Practice Planner: scanned notes and found ${found} skill${found === 1 ? "" : "s"}.`,
				);
			},
		});

		this.registerEditorSuggest(new SkillSuggest(this));

		this.addSettingTab(new PracticePlannerSettingTab(this.app, this));

		// Capture skills typed inline (even brand-new ones never picked from the
		// dropdown) into history. `modify` fires when the editor flushes to disk
		// — debounced after a pause / blur / note switch — not per keystroke.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && this.isPracticeNote(file)) {
					void this.extractSkills(file).then((skills) =>
						this.recordSkills(skills),
					);
				}
			}),
		);

		// Pick up skills used in existing notes once the vault is ready.
		this.app.workspace.onLayoutReady(() => {
			void this.scanVaultForSkills();
		});
	}

	async loadSettings() {
		const data =
			(await this.loadData()) as Partial<PracticePlannerSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Merge the given skill names into the persistent history. History entries
	 * are never auto-removed and are de-duped case-insensitively, preserving
	 * the first-seen casing. Saves only when something new was added.
	 */
	recordSkills(names: string[]): void {
		const seen = new Set(
			this.settings.skillHistory.map((s) => s.toLowerCase()),
		);
		let changed = false;
		for (const raw of names) {
			const name = raw.trim();
			if (!name) continue;
			const key = name.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			this.settings.skillHistory.push(name);
			changed = true;
		}
		if (changed) {
			void this.saveSettings();
		}
	}

	/**
	 * Union of active skills and history, de-duped case-insensitively and
	 * sorted. This is the source list for the `skill::` autocomplete.
	 */
	knownSkills(): string[] {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const raw of [...this.settings.skills, ...this.settings.skillHistory]) {
			const name = raw.trim();
			if (!name) continue;
			const key = name.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(name);
		}
		out.sort((a, b) => a.localeCompare(b));
		return out;
	}

	/** True if the file is a markdown note under the configured practice folder. */
	isPracticeNote(file: TFile): boolean {
		if (file.extension !== "md") return false;
		const folder = this.settings.folderPath.replace(/^\/+|\/+$/g, "");
		const prefix = folder ? `${folder}/` : "";
		return !prefix || file.path.startsWith(prefix);
	}

	/** Extract distinct `skill::` inline field values from a single note. */
	async extractSkills(file: TFile): Promise<string[]> {
		const content = await this.app.vault.cachedRead(file);
		const found = new Set<string>();
		// `[ \t]*` (not `\s*`) so an empty `skill::` line never swallows the
		// following `minutes::` line.
		const re = /skill::[ \t]*([^\n]+)/gi;
		let match: RegExpExecArray | null;
		while ((match = re.exec(content)) !== null) {
			const value = match[1].trim();
			if (value) found.add(value);
		}
		return [...found];
	}

	/**
	 * Scan markdown notes under the configured folder for `skill::` inline
	 * field values and merge them into history. Returns the count of distinct
	 * skill values encountered across the scanned notes.
	 */
	async scanVaultForSkills(): Promise<number> {
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => this.isPracticeNote(f));

		const found = new Set<string>();
		for (const file of files) {
			for (const skill of await this.extractSkills(file)) {
				found.add(skill);
			}
		}

		this.recordSkills([...found]);
		return found.size;
	}

	async openWeek(weekOffset: number) {
		const today = new Date();
		const target = new Date(today);
		target.setDate(target.getDate() + weekOffset * 7);

		const start = startOfWeek(target, this.settings.weekStartDay);
		const { year, week } = weekKey(start, this.settings.weekStartDay);
		const path = this.notePathFor(year, week);

		let file = this.app.vault.getAbstractFileByPath(path);
		if (!file) {
			await this.ensureFolder(path);
			const body = renderTemplate(
				start,
				year,
				week,
				this.settings.weekStartDay,
				this.settings.skills,
			);
			file = await this.app.vault.create(path, body);
		}

		if (file instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(file);
		} else {
			new Notice(`Could not open ${path}`);
		}
	}

	notePathFor(year: number, week: number): string {
		const weekStr = String(week).padStart(2, "0");
		const folder = this.settings.folderPath.replace(/^\/+|\/+$/g, "");
		return normalizePath(`${folder}/${year}/${year}-W${weekStr}.md`);
	}

	async ensureFolder(filePath: string) {
		const parts = filePath.split("/");
		parts.pop();
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}
}

function startOfWeek(date: Date, weekStartDay: DayIndex): Date {
	const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const offset = (d.getDay() - weekStartDay + 7) % 7;
	d.setDate(d.getDate() - offset);
	return d;
}

function firstWeekStartOfYear(year: number, weekStartDay: DayIndex): Date {
	const jan1 = new Date(year, 0, 1);
	const offset = (weekStartDay - jan1.getDay() + 7) % 7;
	return new Date(year, 0, 1 + offset);
}

function weekKey(
	weekStart: Date,
	weekStartDay: DayIndex,
): { year: number; week: number } {
	const year = weekStart.getFullYear();
	const firstStart = firstWeekStartOfYear(year, weekStartDay);
	const msPerWeek = 7 * 24 * 60 * 60 * 1000;
	const diff = weekStart.getTime() - firstStart.getTime();
	const week = Math.floor(diff / msPerWeek) + 1;
	return { year, week };
}

function orderedDays(weekStartDay: DayIndex): DayIndex[] {
	const out: DayIndex[] = [];
	for (let i = 0; i < 7; i++) {
		out.push(((weekStartDay + i) % 7) as DayIndex);
	}
	return out;
}

function addDays(date: Date, days: number): Date {
	const d = new Date(date);
	d.setDate(d.getDate() + days);
	return d;
}

function formatISO(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function renderTemplate(
	weekStart: Date,
	year: number,
	week: number,
	weekStartDay: DayIndex,
	skills: string[],
): string {
	const days = orderedDays(weekStartDay);
	const weekEnd = addDays(weekStart, 6);
	const weekStr = String(week).padStart(2, "0");

	const headerCols = days.map((d) => DAY_SHORT[d]).join(" | ");
	const sepCols = days.map(() => "---").join(" | ");
	const cleanSkills = skills.map((s) => s.trim()).filter(Boolean);
	const skillRows = (cleanSkills.length ? cleanSkills : ["(skill)"])
		.map((s) => `| ${s} | ${days.map(() => " ").join(" | ")} |`)
		.join("\n");

	const dailySections = days
		.map((d, i) => {
			const date = formatISO(addDays(weekStart, i));
			return `### ${DAY_NAMES[d]} — ${date}

- **Session 1**
    - skill::
    - minutes::
    - notes::
`;
		})
		.join("\n");

	return `---
type: practice-week
year: ${year}
week: ${week}
start: ${formatISO(weekStart)}
end: ${formatISO(weekEnd)}
week_start_day: ${DAY_NAMES[weekStartDay]}
---

# Week ${weekStr} of ${year} (${formatISO(weekStart)} – ${formatISO(weekEnd)})

## Goals


## Skills

| Skill | ${headerCols} |
| --- | ${sepCols} |
${skillRows}

## Daily Notes

${dailySections}`;
}

class PracticePlannerSettingTab extends PluginSettingTab {
	plugin: PracticePlannerPlugin;
	private historyEl: HTMLElement | null = null;

	constructor(app: App, plugin: PracticePlannerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private refreshHistory(): void {
		if (this.historyEl) this.renderHistory(this.historyEl);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Folder")
			.setDesc("Vault folder where weekly practice notes are stored.")
			.addText((text) =>
				text
					.setPlaceholder("Practice")
					.setValue(this.plugin.settings.folderPath)
					.onChange((value) => {
						this.plugin.settings.folderPath = value || "Practice";
						void this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Week starts on")
			.setDesc(
				"First day of the practice week. Weeks that cross into a new year are stored under the year they started.",
			)
			.addDropdown((dd) => {
				DAY_NAMES.forEach((name, i) => {
					dd.addOption(String(i), name);
				});
				dd.setValue(String(this.plugin.settings.weekStartDay));
				dd.onChange((value) => {
					this.plugin.settings.weekStartDay = Number(value) as DayIndex;
					void this.plugin.saveSettings();
				});
			});

		this.renderSkills(containerEl.createDiv());
		this.historyEl = containerEl.createDiv();
		this.renderHistory(this.historyEl);
	}

	private renderSkills(containerEl: HTMLElement): void {
		containerEl.empty();

		new Setting(containerEl)
			.setName("Default skills")
			.setDesc("Rows used in each new week's skill table. Edit a name inline, remove a skill, add new ones, or reset to the built-in defaults.")
			.setHeading();

		this.plugin.settings.skills.forEach((skill, index) => {
			new Setting(containerEl).addText((text) => {
				text
					.setPlaceholder("Skill name")
					.setValue(skill)
					.onChange((value) => {
						this.plugin.settings.skills[index] = value.trim();
						void this.plugin.saveSettings();
					});
				// Record the finished name (not every keystroke) when the
				// field loses focus, then refresh the history list.
				text.inputEl.addEventListener("blur", () => {
					this.plugin.recordSkills([this.plugin.settings.skills[index]]);
					this.refreshHistory();
				});
			}).addExtraButton((btn) => {
				btn
					.setIcon("trash")
					.setTooltip("Remove skill")
					.onClick(() => {
						this.plugin.settings.skills.splice(index, 1);
						void this.plugin.saveSettings();
						this.renderSkills(containerEl);
						this.refreshHistory();
					});
			});
		});

		new Setting(containerEl)
			.addButton((btn) => {
				btn
					.setButtonText("Add skill")
					.onClick(() => {
						this.plugin.settings.skills.push("");
						void this.plugin.saveSettings();
						this.renderSkills(containerEl);
					});
			})
			.addButton((btn) => {
				btn
					.setButtonText("Reset to default")
					.setCta()
					.onClick(() => {
						this.plugin.settings.skills = [...DEFAULT_SETTINGS.skills];
						this.plugin.recordSkills(this.plugin.settings.skills);
						void this.plugin.saveSettings();
						this.renderSkills(containerEl);
						this.refreshHistory();
					});
			});
	}

	private renderHistory(containerEl: HTMLElement): void {
		containerEl.empty();

		const active = new Set(
			this.plugin.settings.skills.map((s) => s.trim().toLowerCase()),
		);
		const history = [...this.plugin.settings.skillHistory].sort((a, b) =>
			a.localeCompare(b),
		);

		new Setting(containerEl)
			.setName("Skill history")
			.setDesc(
				"Every skill ever used, including ones removed from the list above. These power the skill:: autocomplete in your notes.",
			)
			.setHeading();

		if (history.length === 0) {
			containerEl.createEl("p", {
				text: "No skills recorded yet.",
				cls: "setting-item-description",
			});
		} else {
			for (const name of history) {
				const isActive = active.has(name.trim().toLowerCase());
				const row = new Setting(containerEl).setName(
					isActive ? `${name} (active)` : name,
				);
				row.addExtraButton((btn) => {
					btn
						.setIcon("trash")
						.setTooltip(
							isActive
								? "Remove from history (still in the list above)"
								: "Remove from history",
						)
						.onClick(() => {
							this.plugin.settings.skillHistory =
								this.plugin.settings.skillHistory.filter(
									(s) => s !== name,
								);
							void this.plugin.saveSettings();
							this.renderHistory(containerEl);
						});
				});
			}
		}

		new Setting(containerEl).addButton((btn) => {
			btn
				.setButtonText("Clear history")
				.setWarning()
				.onClick(() => {
					// Keep the active skills so autocomplete still works.
					this.plugin.settings.skillHistory = [
						...this.plugin.settings.skills,
					]
						.map((s) => s.trim())
						.filter(Boolean);
					void this.plugin.saveSettings();
					this.renderHistory(containerEl);
				});
		});
	}
}

class SkillSuggest extends EditorSuggest<string> {
	plugin: PracticePlannerPlugin;

	constructor(plugin: PracticePlannerPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
	): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line).slice(0, cursor.ch);
		const match = line.match(/skill::[ \t]*(.*)$/i);
		if (!match) return null;

		const query = match[1];
		// Column where the value begins (just after `skill::` and any spaces).
		const start = cursor.ch - query.length;
		return {
			start: { line: cursor.line, ch: start },
			end: cursor,
			query,
		};
	}

	getSuggestions(context: EditorSuggestContext): string[] {
		const query = context.query.trim().toLowerCase();
		const skills = this.plugin.knownSkills();
		if (!query) return skills;
		return skills.filter((s) => s.toLowerCase().includes(query));
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		const { context } = this;
		if (!context) return;
		context.editor.replaceRange(value, context.start, context.end);
		const end: EditorPosition = {
			line: context.start.line,
			ch: context.start.ch + value.length,
		};
		context.editor.setCursor(end);
		this.plugin.recordSkills([value]);
	}
}
