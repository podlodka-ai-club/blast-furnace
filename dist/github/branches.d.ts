export declare function pushBranch(branchName: string, sha: string, force?: boolean): Promise<void>;
export declare function getRef(branchName: string): Promise<string>;
export declare function deleteBranch(branchName: string): Promise<void>;
