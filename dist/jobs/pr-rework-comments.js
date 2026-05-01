function withinWindow(createdAt, since, until) {
    const created = new Date(createdAt).getTime();
    if (Number.isNaN(created))
        return false;
    if (since !== undefined && created < new Date(since).getTime())
        return false;
    if (until !== undefined && created > new Date(until).getTime())
        return false;
    return true;
}
function qualifies(comment, input) {
    if (!withinWindow(comment.createdAt, input.since, input.until))
        return false;
    if (input.blastFurnaceLogin && comment.authorLogin === input.blastFurnaceLogin)
        return false;
    if (comment.authorType === 'Bot')
        return false;
    if (comment.outdated === true)
        return false;
    if (comment.resolved === true)
        return false;
    if (comment.deleted === true)
        return false;
    return comment.body.trim().length > 0;
}
function normalize(input) {
    return [
        ...input.reviewComments.map((comment) => ({
            id: comment.id,
            kind: 'review',
            authorLogin: comment.authorLogin,
            authorType: comment.authorType,
            body: comment.body,
            createdAt: comment.createdAt,
            path: comment.path,
            line: comment.line,
            outdated: comment.outdated,
            resolved: comment.resolved,
            deleted: comment.deleted,
        })),
        ...input.pullRequestComments.map((comment) => ({
            id: comment.id,
            kind: 'pull-request',
            authorLogin: comment.authorLogin,
            authorType: comment.authorType,
            body: comment.body,
            createdAt: comment.createdAt,
        })),
    ].sort((a, b) => {
        const byTime = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return byTime === 0 ? a.id - b.id : byTime;
    });
}
function renderComment(comment, index) {
    const lines = [
        `### Comment ${index}: ${comment.kind === 'review' ? 'Review Comment' : 'PR Comment'}`,
        `Author: @${comment.authorLogin}`,
        `Created: ${comment.createdAt}`,
    ];
    if (comment.path !== undefined) {
        lines.push(`File: \`${comment.path}\``);
    }
    if (comment.line !== undefined) {
        lines.push(`Line: ${comment.line}`);
    }
    lines.push('', comment.body.trim());
    return lines.join('\n');
}
export function buildPrReworkCommentsMarkdown(input) {
    const comments = normalize(input).filter((comment) => qualifies(comment, input));
    if (comments.length === 0) {
        return '';
    }
    return [
        '# PR Review Comments',
        '',
        ...comments.map((comment, index) => renderComment(comment, index + 1)),
    ].join('\n\n');
}
