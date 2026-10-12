/* Workflow packaging: trace what a workflow uses, scan it for secrets, write a
 * .pdpkg. Nothing here imports a Node built-in or @corenel. */
export { isPackageRef, workflowNodeRefs, prmdFileRefs } from './refs'
export type { FileRefs } from './refs'
export { traceWorkflowFiles } from './trace'
export type { WorkflowFileReader, WorkflowTrace } from './trace'
export { scanForSecrets } from './secrets'
export type { SecretHit } from './secrets'
export { buildWorkflowPackage, packagePathError } from './pack'
export type { WorkflowPackageFile, WorkflowPackageManifest } from './pack'
