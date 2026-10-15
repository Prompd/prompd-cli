import * as core from '../src';

describe('@prompd/core package exports', () => {
  it('exposes the verification surface from the root', () => {
    for (const name of [
      'openPdpkg', 'packPdpkg', 'computeIntegrity', 'verifyInstalled', 'checkAgentPackage', 'createRegistryDownloader',
      'encodePackageName', 'PackageVerificationError', 'isPackageVerificationError', 'describeVerificationFailure',
      'archiveDigest', 'parseManifest', 'unscopedName', 'ARCHIVE_COPY', 'META_FILE', 'AGENT_PACKAGE_FILES', 'DIGEST_RE',
      'installPackage', 'uninstallPackage', 'extractPdpkg',
    ]) {
      expect(core).toHaveProperty(name);
    }
  });

  it('does not expose the unchecked archive reader from the root', () => {
    expect(core).not.toHaveProperty('readArchive');
    expect(core).toHaveProperty('entryNameProblem');
    expect(core).toHaveProperty('ARCHIVE_LIMITS');
  });
});
