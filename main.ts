import {
	App,
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
}

const DEFAULT_SETTINGS: PracticePlannerSettings = {
	folderPath: "Practice",
	weekStartDay: 1,
	skills: ["Scales", "Technique", "Repertoire", "Sight Reading"],
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

		this.addSettingTab(new PracticePlannerSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
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
	const skillRows = (skills.length ? skills : ["(skill)"])
		.map((s) => `| ${s} | ${days.map(() => " ").join(" | ")} |`)
		.join("\n");

	const dailySections = days
		.map((d, i) => {
			const date = addDays(weekStart, i);
			return `### ${DAY_NAMES[d]} — ${formatISO(date)}\n- \n`;
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

	constructor(app: App, plugin: PracticePlannerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
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
					.onChange(async (value) => {
						this.plugin.settings.folderPath = value || "Practice";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Week starts on")
			.setDesc(
				"First day of the practice week. Weeks that cross into a new year are stored under the year they started.",
			)
			.addDropdown((dd) => {
				DAY_NAMES.forEach((name, i) => dd.addOption(String(i), name));
				dd.setValue(String(this.plugin.settings.weekStartDay));
				dd.onChange(async (value) => {
					this.plugin.settings.weekStartDay = Number(value) as DayIndex;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Default skills")
			.setDesc("One skill per line. Used as rows in each new week's skill table.")
			.addTextArea((ta) => {
				ta.setPlaceholder("Scales\nTechnique\nRepertoire\nSight Reading");
				ta.setValue(this.plugin.settings.skills.join("\n"));
				ta.onChange(async (value) => {
					this.plugin.settings.skills = value
						.split("\n")
						.map((s) => s.trim())
						.filter(Boolean);
					await this.plugin.saveSettings();
				});
				ta.inputEl.rows = 6;
				ta.inputEl.cols = 30;
			});
	}
}
