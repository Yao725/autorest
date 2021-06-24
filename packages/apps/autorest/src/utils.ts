import { AutorestArgs } from "./args";
import { AutorestConfiguration, ConfigurationLoader } from "@autorest/configuration";
import { AutorestLogger } from "@autorest/configuration/node_modules/@autorest/common";
import { createFileOrFolderUri, createFolderUri, resolveUri } from "@azure-tools/uri";
import { AppRoot } from "./constants";
import { extensionManager, networkEnabled, selectVersion } from "./autorest-as-a-service";
import chalk from "chalk";
import { checkForAutoRestUpdate } from "./actions";
import { isFile } from "@azure-tools/async-io";
import { dirname, join, resolve } from "path";
import untildify from "untildify";

const inWebpack = typeof __webpack_require__ === "function";
const nodeRequire = inWebpack ? __non_webpack_require__ : require;
const defaultConfigUri = inWebpack
  ? resolveUri(createFolderUri(AppRoot), `dist/resources/default-configuration.md`)
  : createFileOrFolderUri(nodeRequire.resolve("@autorest/configuration/resources/default-configuration.md"));

/**
 * Return the version requested of the core extension.
 * @param args ClI args.
 * @returns npm version/tag.
 */
export const getRequestedCoreVersion = (args: AutorestArgs): string | undefined => {
  return args.version || (args.latest && "latest") || (args.preview && "preview");
};

const cwd = process.cwd();

/**
 * Tries to load the configuration of autorest.
 * @param args CLI args.
 */
export async function loadConfig(args: AutorestArgs): Promise<AutorestConfiguration> {
  const configFileOrFolder = resolveUri(createFolderUri(cwd), args.configFileOrFolder || ".");
  /* eslint-disable no-console */
  const logger: AutorestLogger = {
    fatal: (x) => args.verbose && console.error(x),
    info: (x) => args.verbose && console.log(x),
    verbose: (x) => args.verbose && console.log(x),
    trackError: (x) => console.error(x),
    trackWarning: (x) => console.error(x),
  };
  /* eslint-enable no-console */

  const loader = new ConfigurationLoader(logger, defaultConfigUri, configFileOrFolder, {
    extensionManager: await extensionManager,
  });
  const { config } = await loader.load([args], true);
  if (config.version) {
    // eslint-disable-next-line no-console
    console.log(
      chalk.yellow(`NOTE: AutoRest core version selected from configuration: ${chalk.yellow.bold(config.version)}.`),
    );
  }
  return config;
}

/**
 * Check if the requested version points to a local dev version of @autorest/core or there is one globally available.
 * @param requestedVersion Core version
 * @returns Path to the local version or undefined if there isn't one.
 */
export async function resolvePathForLocalVersion(requestedVersion: string | null): Promise<string | undefined> {
  try {
    const localVersion = requestedVersion
      ? resolve(untildify(requestedVersion))
      : dirname(nodeRequire.resolve("@autorest/core/package.json"));

    return (await isFile(join(localVersion, "package.json"))) ? localVersion : undefined;
  } catch (e) {
    // fallback to old-core name
    try {
      // eslint-disable-next-line node/no-missing-require
      return dirname(nodeRequire.resolve("@microsoft.azure/autorest-core/package.json"));
    } catch {
      // no dice
    }
  }
  return undefined;
}

export async function resolveCoreVersion(config: AutorestConfiguration): Promise<string> {
  const requestedVersion: string = getRequestedCoreVersion(config) ?? "latest-installed";

  const localVersion = await resolvePathForLocalVersion(config.version ? requestedVersion : null);
  if (localVersion) {
    return localVersion;
  }

  // failing that, we'll continue on and see if NPM can do something with the version.
  if (config.debug) {
    // eslint-disable-next-line no-console
    console.log(`Network Enabled: ${await networkEnabled}`);
  }

  // wait for the bootstrapper check to finish.
  await checkForAutoRestUpdate(config);

  // logic to resolve and optionally install a autorest core package.
  // will throw if it's not doable.
  const selectedVersion = await selectVersion(requestedVersion, config.debugger);
  return selectedVersion.modulePath;
}

/**
 *
 * @param maxMemory Max memory string(2048m, 2g)
 * @returns Max memory that will be allowed for the cnode process in MB
 */
export function parseMemory(maxMemory: string): number {
  const regex = /^(\d+)([mg])$/i;
  const match = regex.exec(maxMemory.trim());

  if (!match) {
    throw new Error(
      `Couldn't parse memory setting ${maxMemory}. Please provide in this format: 2048m, 2g, etc. Supported units: m,g`,
    );
  }

  const number = Number(match[1]);
  const unit = match[2];
  return number * getUnitMultiplier(unit);
}

function getUnitMultiplier(unit: string): number {
  switch (unit) {
    case "m":
      return 1; // = 1024 * 1024;
    case "g":
      return 1024; // 1024 * 1024 * 1024;
    default:
      throw new Error(`Unexpected unit ${unit}.`);
  }
}
