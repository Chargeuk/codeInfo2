#!/usr/bin/env node

const args = process.argv.slice(2);
let instant = new Date();

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--instant') {
    const value = args[index + 1];
    if (!value) {
      console.error('--instant requires an ISO-8601 value');
      process.exit(1);
    }
    instant = new Date(value);
    index += 1;
    continue;
  }

  console.error(`Unknown argument: ${args[index]}`);
  process.exit(1);
}

if (Number.isNaN(instant.getTime())) {
  console.error('The supplied instant is not a valid date');
  process.exit(1);
}

const resolved = Intl.DateTimeFormat().resolvedOptions();
const locale = process.env.CODEINFO_DISPLAY_LOCALE?.trim() || resolved.locale;
const timeZone =
  process.env.CODEINFO_DISPLAY_TIME_ZONE?.trim() || resolved.timeZone || 'UTC';

let formatted;
try {
  formatted = new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'long',
    timeZone,
  }).format(instant);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unable to format the display timestamp: ${message}`);
  process.exit(1);
}

console.log(`${formatted} [locale=${locale}; timeZone=${timeZone}]`);
