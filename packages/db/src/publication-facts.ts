// Alias p is the current portfolio. Only bounded mutable authorization facts
// enter the ticket. Credentials, calendars and recipient addresses never do.
export const publicationFacts = `json_object(
 'address',(SELECT json_object('name',s.name,'state',s.state,'reserved',EXISTS(SELECT 1 FROM reserved_subdomain r WHERE r.name=s.name)) FROM subdomain_claim s WHERE s.portfolio_id=p.id),
 'recipient',(SELECT json_object('verifiedAt',r.verified_at) FROM contact_recipient r WHERE r.portfolio_id=p.id),
 'github',(SELECT json_object('generation',g.generation,'status',g.status,'private',g.private_enabled,'grant',g.grant_operation,'activity',a.generation,'fetched',a.fetched_at,'grantState',t.state) FROM github_connection g LEFT JOIN github_activity a ON a.portfolio_id=g.portfolio_id LEFT JOIN github_grant t ON t.portfolio_id=g.portfolio_id AND t.operation_id=g.grant_operation WHERE g.portfolio_id=p.id)
)`;
export const candidateUnretained =
  "NOT EXISTS(SELECT 1 FROM publish_version v WHERE v.candidate_id=publication_candidate.id)";
