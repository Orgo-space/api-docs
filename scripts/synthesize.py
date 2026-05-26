"""
Schema-driven example synthesizer for the Orgo OpenAPI spec.

Given an OpenAPI 3.1 schema (possibly with $refs, allOf/oneOf/anyOf, nullable
types, and formats), produce a concrete JSON value that an LLM or human can
copy verbatim as a working request body or response payload.

Design principles:
  - Deterministic: same input -> same output, every run.
  - Realistic: values look like data ("James Patterson", not "string").
  - LLM-friendly: persona is consistent across the whole spec so the docs
    tell a coherent story (one organization, one local center, one cast of
    people, dates anchored on Jan 2026).
  - Safe: persona uses RFC 2606 reserved domain (example.com) and NANP 555
    fictional phone numbers. No real PII.

Public entry points:
  SchemaSynthesizer(components_schemas).synthesize(schema, for_write=True)
  SchemaSynthesizer(components_schemas).synthesize(schema, for_write=False)
"""

from __future__ import annotations

from typing import Any
import re


def _tokens(name: str) -> list[str]:
    """Split camelCase / snake_case / kebab-case into lower-case tokens.

    `firstName` -> ["first", "name"]
    `profile_linkedin` -> ["profile", "linkedin"]
    `stripeCustomerId` -> ["stripe", "customer", "id"]
    `IPAddress` -> ["ip", "address"]
    """
    # Insert space before camelCase boundaries, then split on _ - or space.
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name)
    spaced = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", spaced)
    parts = re.split(r"[_\-\s]+", spaced)
    return [p.lower() for p in parts if p]


def _tokens_joined_lower(name: str) -> str:
    return "".join(_tokens(name))


# ─── Persona ─────────────────────────────────────────────────────────────────
#
# A small, consistent cast that recurs across every example. Reusing the same
# names/IRIs across the whole spec gives the docs a sense of continuity — the
# reader recognises "Boston" and "James Patterson" the third time they see
# them and starts to model the system.

PERSONA = {
    "tenant_subdomain": "acme",
    "tenant_id": 1,
    "local_centers": [
        {"id": 4, "name": "Boston"},
        {"id": 7, "name": "Manchester"},
        {"id": 12, "name": "San Francisco"},
    ],
    "people": [
        {
            "first": "James", "last": "Patterson",
            "email_user": "james.patterson",
            "phone": "+1 415 555 0142",
        },
        {
            "first": "Emma", "last": "Whitfield",
            "email_user": "emma.whitfield",
            "phone": "+44 20 7946 0958",
        },
        {
            "first": "Sarah", "last": "O'Connor",
            "email_user": "sarah.oconnor",
            "phone": "+1 617 555 0177",
        },
        {
            "first": "Michael", "last": "Chen",
            "email_user": "michael.chen",
            "phone": "+1 415 555 0188",
        },
    ],
    "events": [
        {"id": 12, "uuid": "01938d8e-9c4f-7c2a-b8e1-3f7a9b8c4f12", "name": "Annual General Meeting 2026"},
        {"id": 18, "uuid": "01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f18", "name": "Volunteer Workshop"},
    ],
    "company_name": "Civic Collective",
    "currency": "USD",
    "country_iso2": "US",
    "country_iso3": "USA",
    "timezone": "America/New_York",
    "language": "en",
    "anchor_date": "2026-01-15",
    "anchor_datetime": "2026-01-15T10:30:00+00:00",
}


# ─── Field-name heuristics ───────────────────────────────────────────────────
#
# When the schema gives us nothing but a type ("string"), we fall back to
# guessing from the property name. Order matters — more specific patterns
# first.

# Exact field-name overrides. Highest priority — beats format and pattern matching.
EXACT_STRING = {
    "id": None,                     # delegated to integer/string-id handling
    "@id": None,                    # delegated to IRI handling
    "@type": None,
    "@context": None,
    "uuid": "01938d8e-9c4f-7c2a-b8e1-3f7a9b8c4f12",
    "hash": "a3f8b2c4d6e8f1a3b5c7d9e1f3a5b7c9",
    "slug": "annual-general-meeting-2026",
    "slugGo": "agm26",
    "code": "BOS-2026-Q1",
    "secret": "whsec_a3f8b2c4d6e8f1a3b5c7d9e1f3a5b7c9",
    "token": "01938d8e-9c4f-7c2a-b8e1-3f7a9b8c4f12",
    "refreshToken": "f3c7a2b1d4e6f8a1c3b5d7e9f1a3b5c7d9e1f3a5",
    "name": "Boston Chapter",
    "shortName": "Boston",
    "displayName": "James Patterson",
    "fullName": "James Patterson",
    "firstName": "James",
    "lastName": "Patterson",
    "middleName": None,
    "nickname": "Jim",
    "gender": "M",
    "title": "Volunteer Coordinator",
    "subject": "Welcome to Boston Chapter",
    "message": "Looking forward to seeing you at the meeting.",
    "comment": "Confirmed by phone — will arrive at 10am.",
    "description": "Quarterly chapter meeting open to all members.",
    "content": "<p>Hello {{firstName}},</p><p>You're invited.</p>",
    "body": "<p>Hello {{firstName}},</p><p>You're invited.</p>",
    "html": "<p>Hello {{firstName}},</p><p>You're invited.</p>",
    "text": "Hello, you're invited to the Annual General Meeting.",
    "summary": "Quarterly meeting — open to all members.",
    "headline": "Lead organizer at Boston Chapter",
    "tagline": "Civic Collective — your neighborhood, organized.",
    "status": "ACTIVE",
    "state": "ACTIVE",
    "type": "MEMBER",
    "kind": "STANDARD",
    "role": "ROLE_USER",
    "currency": "USD",
    "locale": "en_US",
    "language": "en",
    "lang": "en",
    "timezone": "America/New_York",
    "country": "US",
    "countryCode": "US",
    "phoneNumber": "+1 415 555 0142",
    "phone": "+1 415 555 0142",
    "fax": "+1 415 555 0143",
    "vatNumber": "US123456789",
    "vatId": "US123456789",
    "iban": "US12 3456 7890 1234 5678 90",
    "bic": "BOFAUS3N",
    "city": "Boston",
    "town": "Boston",
    "state_province": "MA",
    "region": "Massachusetts",
    "zip": "02108",
    "zipCode": "02108",
    "postalCode": "02108",
    "address": "123 Beacon Street",
    "addressLine1": "123 Beacon Street",
    "addressLine2": "Suite 400",
    "street": "Beacon Street",
    "houseNumber": "123",
    "website": "https://civic-collective.example.com",
    "url": "https://civic-collective.example.com/agm",
    "uri": "https://civic-collective.example.com/agm",
    "logo": "https://cdn.orgo.space/tenants/acme/logo.png",
    "avatar": "https://cdn.orgo.space/users/42/avatar.jpg",
    "image": "https://cdn.orgo.space/events/12/cover.jpg",
    "cover": "https://cdn.orgo.space/events/12/cover.jpg",
    "thumbnail": "https://cdn.orgo.space/events/12/thumb.jpg",
    "filename": "annual-report-2026.pdf",
    "mimeType": "application/pdf",
    "mime_type": "application/pdf",
    "contentType": "application/pdf",
    "extension": "pdf",
    "checksum": "a3f8b2c4d6e8f1a3b5c7d9e1f3a5b7c9",
    "color": "#16A34A",
    "colour": "#16A34A",
    "icon": "calendar",
    "tag": "donor-2026",
    "tags": None,                   # array, handled elsewhere
    "keyword": "patterson",
    "search": "patterson",
    "query": "patterson",
    "ip": "192.0.2.42",
    "ipAddress": "192.0.2.42",
    "userAgent": "Mozilla/5.0",
    "label": "Primary",
    "value": "Vegetarian",
    "key": "diet_preference",
    "questionText": "What dietary preferences do you have?",
    "answer": "Vegetarian",
    "answerText": "Vegetarian",
    "linkedin": "https://linkedin.com/in/james-patterson",
    "facebook": "https://facebook.com/jamespatterson",
    "twitter": "https://twitter.com/jpatterson",
    "instagram": "https://instagram.com/jpatterson",
    "youtube": "https://youtube.com/@civic-collective",
    "tiktok": "https://tiktok.com/@civic-collective",
    "telegram": "https://t.me/jpatterson",
    "whatsapp": "+14155550142",
    "signal": "+14155550142",
    "bsky": "@jpatterson.bsky.social",
    "stripeAccountId": "acct_1MhsK3LZvKYlo2C0",
    "stripeCustomerId": "cus_NhpBuxIyR4Qbpd",
    "stripeSubscriptionId": "sub_1Mn6KFLZvKYlo2C0",
    "stripePaymentIntentId": "pi_3MhsK3LZvKYlo2C0",
    "stripeChargeId": "ch_3MhsK3LZvKYlo2C0",
    "stripePriceId": "price_1Mhs9zLZvKYlo2C0",
    "stripeProductId": "prod_NhpAuxIyR4Qbpd",
    "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4e5F6",
    "ipnUrl": "https://app.orgo.space/api/v1/stripe-webhook",
    "callbackUrl": "https://your-app.example.com/callbacks/orgo",
    "redirectUrl": "https://your-app.example.com/done",
    "webhookUrl": "https://your-app.example.com/webhooks/orgo",
    "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANS...",
}

# Token-match patterns for property names. A "token" is a camelCase / snake_case
# segment of the field name — `stripeAccount` -> ["stripe", "account"],
# `profile_linkedin` -> ["profile", "linkedin"]. Tokens are matched in order
# from MOST specific to LEAST specific (`linkedin` before `link`, etc.) and the
# first token in the field name that hits a pattern wins. This avoids the
# greedy-substring trap where `ip` would match `str[ip]e`.
TOKEN_STRING: list[tuple[str, str]] = [
    # Social handles / profile URLs — must come before the generic "url"/"link".
    ("linkedin", "https://linkedin.com/in/james-patterson"),
    ("facebook", "https://facebook.com/jamespatterson"),
    ("twitter", "https://twitter.com/jpatterson"),
    ("instagram", "https://instagram.com/jpatterson"),
    ("youtube", "https://youtube.com/@civic-collective"),
    ("tiktok", "https://tiktok.com/@civic-collective"),
    ("telegram", "https://t.me/jpatterson"),
    ("whatsapp", "+14155550142"),
    ("signal", "+14155550142"),
    ("bsky", "@jpatterson.bsky.social"),

    # Stripe identifiers — before the generic "id".
    ("stripeaccount", "acct_1MhsK3LZvKYlo2C0"),
    ("stripecustomer", "cus_NhpBuxIyR4Qbpd"),
    ("stripesubscription", "sub_1Mn6KFLZvKYlo2C0"),
    ("stripepaymentintent", "pi_3MhsK3LZvKYlo2C0"),
    ("stripecharge", "ch_3MhsK3LZvKYlo2C0"),
    ("stripeprice", "price_1Mhs9zLZvKYlo2C0"),
    ("stripeproduct", "prod_NhpAuxIyR4Qbpd"),
    ("stripecheckoutsession", "cs_test_a1B2c3D4e5F6"),

    # Long-form text fields.
    ("biography", "Volunteer organizer in the Boston chapter since 2022."),
    ("bio", "Volunteer organizer in the Boston chapter since 2022."),
    ("notes", "Joined via the Boston outreach drive on 2026-01-10."),
    ("note", "Joined via Boston outreach drive."),
    ("reason", "Looking to contribute to local civic projects."),
    ("comment", "Confirmed by phone — will arrive at 10am."),
    ("description", "Quarterly chapter meeting open to all members."),
    ("question", "What is your reason for joining?"),
    ("answer", "Vegetarian"),
    ("message", "Looking forward to seeing you at the meeting."),

    # Person identity.
    ("emailaddress", "james.patterson@example.com"),
    ("email", "james.patterson@example.com"),
    ("username", "james.patterson"),
    ("password", "Sup3rSecret!2026"),
    ("plainpassword", "Sup3rSecret!2026"),
    ("firstname", "James"),
    ("lastname", "Patterson"),
    ("fullname", "James Patterson"),
    ("displayname", "James Patterson"),
    ("middlename", "L."),
    ("nickname", "Jim"),
    ("phonecountry", "US"),
    ("phonenumber", "+1 415 555 0142"),
    ("phone", "+1 415 555 0142"),
    ("fax", "+1 415 555 0143"),

    # Geo + addresses.
    ("postcode", "02108"),
    ("postal", "02108"),
    ("postalcode", "02108"),
    ("zipcode", "02108"),
    ("zip", "02108"),
    ("city", "Boston"),
    ("town", "Boston"),
    ("address", "123 Beacon Street, Boston, MA 02108"),
    ("street", "Beacon Street"),
    ("countryname", "United States"),
    ("countrycode", "US"),
    ("country", "US"),
    ("currency", "USD"),
    ("language", "en"),
    ("locale", "en_US"),
    ("timezone", "America/New_York"),
    ("latitude", "42.3601"),
    ("longitude", "-71.0589"),
    ("lat", "42.3601"),
    ("lng", "-71.0589"),

    # File / media.
    ("filename", "annual-report-2026.pdf"),
    ("filepath", "/uploads/2026/01/annual-report-2026.pdf"),
    ("filesize", "245678"),
    ("mimetype", "application/pdf"),
    ("contenttype", "application/pdf"),
    ("extension", "pdf"),

    # IDs and identifiers — careful ordering before token "id" alone.
    ("vatnumber", "US123456789"),
    ("vatid", "US123456789"),
    ("vat", "US123456789"),
    ("iban", "US12 3456 7890 1234 5678 90"),
    ("bic", "BOFAUS3N"),
    ("uuid", "01938d8e-9c4f-7c2a-b8e1-3f7a9b8c4f12"),
    ("hash", "a3f8b2c4d6e8f1a3b5c7d9e1f3a5b7c9"),
    ("checksum", "a3f8b2c4d6e8f1a3b5c7d9e1f3a5b7c9"),
    ("signature", "a3f8b2c4d6e8f1a3b5c7d9e1f3a5b7c9"),
    ("token", "01938d8e-9c4f-7c2a-b8e1-3f7a9b8c4f12"),
    ("secret", "whsec_a3f8b2c4d6e8f1a3b5c7d9e1f3a5b7c9"),
    ("apikey", "ot_7f3c8b4e2a1d6f9c5b3a8e7d4c2f1a9b"),
    ("apitoken", "ot_7f3c8b4e2a1d6f9c5b3a8e7d4c2f1a9b"),
    ("clientid", "orgo_app_client_3f7c2a8e9b4d1f6c"),
    ("clientsecret", "orgo_app_secret_8b3e9c2f4a7d1b5e8f3c9a2b6d4e7c1f"),

    # Search / filter strings.
    ("keyword", "patterson"),
    ("search", "patterson"),
    ("query", "patterson"),

    # Network.
    ("ipaddress", "192.0.2.42"),
    ("useragent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15"),

    # URLs — generic, after the social and stripe patterns above.
    ("website", "https://civic-collective.example.com"),
    ("webhookurl", "https://your-app.example.com/webhooks/orgo"),
    ("callbackurl", "https://your-app.example.com/callbacks/orgo"),
    ("redirecturl", "https://your-app.example.com/done"),
    ("redirecturi", "https://your-app.example.com/done"),
    ("checkouturl", "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4e5F6"),
    ("avatarurl", "https://cdn.orgo.space/users/42/avatar.jpg"),
    ("imageurl", "https://cdn.orgo.space/events/12/cover.jpg"),
    ("avatar", "https://cdn.orgo.space/users/42/avatar.jpg"),
    ("image", "https://cdn.orgo.space/events/12/cover.jpg"),
    ("cover", "https://cdn.orgo.space/events/12/cover.jpg"),
    ("thumbnail", "https://cdn.orgo.space/events/12/thumb.jpg"),
    ("logo", "https://cdn.orgo.space/tenants/acme/logo.png"),
    ("url", "https://civic-collective.example.com"),
    ("uri", "https://civic-collective.example.com"),
    ("link", "https://civic-collective.example.com"),

    # Visual.
    ("color", "#16A34A"),
    ("colour", "#16A34A"),
    ("icon", "calendar"),
    ("emoji", "🎉"),

    # Domain-specific text fields commonly seen in Event / Course / Adhesion.
    ("goal", "Increase active volunteer participation by 20% this quarter."),
    ("target", "All active members in the Boston local center."),
    ("activities", "Welcome remarks, working-group breakouts, and a social hour to close."),
    ("advertising", "Promoted via newsletter, on the homepage, and through partner channels."),
    ("budget", "Estimated $1,200 for venue and refreshments."),
    ("partners", "Boston Public Library, City of Boston Civic Engagement Office."),
    ("organisation", "Civic Collective"),
    ("organization", "Civic Collective"),
    ("organisationname", "Civic Collective"),
    ("organizationname", "Civic Collective"),
    ("organisationrole", "Chapter Lead"),
    ("companyname", "Civic Collective LLC"),
    ("companyidentifier", "US-123456789"),
    ("companyregno", "DE-HRB-12345"),
    ("companyaddress", "123 Beacon Street, Boston, MA 02108"),
    ("placesapiid", "ChIJOwg_06VPwokRYv534QaPC8g"),
    ("placeapi", "ChIJOwg_06VPwokRYv534QaPC8g"),
    ("meet", "https://meet.google.com/abc-defg-hij"),
    ("meeting", "https://meet.google.com/abc-defg-hij"),
    ("meetinglink", "https://meet.google.com/abc-defg-hij"),
    ("meetingurl", "https://meet.google.com/abc-defg-hij"),
    ("zoomlink", "https://us02web.zoom.us/j/12345678901"),
    ("conferenceurl", "https://meet.google.com/abc-defg-hij"),
    ("sector", "Civic Engagement"),
    ("industry", "Non-profit"),
    ("expertise", "Community Organizing"),
    ("expertiseother", "Conflict resolution, public-records research."),
    ("education", "BA Political Science, Boston University (2018)."),
    ("educationstatus", "GRADUATE"),
    ("agenda", "10:00 Welcome • 10:30 Working groups • 12:00 Lunch • 13:00 Plenary"),

    # Member-facing labels and statuses (only as last-resort partial match).
    ("title", "Annual General Meeting 2026"),
    ("subject", "Welcome to Boston Chapter"),
    ("headline", "Lead organizer at Boston Chapter"),
    ("tagline", "Civic Collective — your neighborhood, organized."),
    ("status", "ACTIVE"),
    ("state", "ACTIVE"),
    ("category", "GENERAL"),
    ("level", "STANDARD"),
    ("priority", "NORMAL"),
    ("severity", "INFO"),
    ("role", "ROLE_USER"),
    ("place", "Boston Common"),
    ("location", "Boston Common, Boston, MA"),
    ("placeholder", "{{firstName}}"),
    ("hint", "Use your legal name as it appears on ID."),
    ("label", "Primary"),
    ("name", "Boston Chapter"),
]


# ─── Synthesizer ─────────────────────────────────────────────────────────────


class SchemaSynthesizer:
    MAX_DEPTH = 6

    def __init__(self, components_schemas: dict[str, Any]):
        self.schemas = components_schemas

    def synthesize(
        self,
        schema: dict[str, Any],
        *,
        for_write: bool = False,
        prop_name: str | None = None,
        depth: int = 0,
        seen: frozenset[str] | None = None,
    ) -> Any:
        if seen is None:
            seen = frozenset()

        if not isinstance(schema, dict):
            return None

        # $ref resolution with cycle guard.
        ref = schema.get("$ref")
        if ref:
            if ref in seen or depth >= self.MAX_DEPTH:
                # Break the cycle by returning a stub IRI.
                return self._stub_iri(ref)
            target = self._resolve_ref(ref)
            if target is None:
                return None
            return self.synthesize(
                target,
                for_write=for_write,
                prop_name=prop_name,
                depth=depth + 1,
                seen=seen | {ref},
            )

        # Honour an explicit example on the schema itself.
        if "example" in schema:
            return schema["example"]
        if "examples" in schema and isinstance(schema["examples"], list) and schema["examples"]:
            return schema["examples"][0]

        # Composition.
        if "allOf" in schema:
            merged: dict[str, Any] = {}
            for sub in schema["allOf"]:
                val = self.synthesize(
                    sub, for_write=for_write, prop_name=prop_name, depth=depth, seen=seen,
                )
                if isinstance(val, dict):
                    merged.update(val)
            return merged or self._maybe_object(schema, for_write, depth, seen)

        if "oneOf" in schema or "anyOf" in schema:
            options = schema.get("oneOf") or schema.get("anyOf") or []
            for opt in options:
                if not isinstance(opt, dict):
                    continue
                if opt.get("type") == "null":
                    continue
                # If the option is `{"type": "null"}` inside a nullable wrap,
                # skip it and try the next.
                val = self.synthesize(
                    opt, for_write=for_write, prop_name=prop_name, depth=depth, seen=seen,
                )
                if val is not None:
                    return val
            return None

        # Resolve the effective type (handle nullable `["string","null"]`).
        t = schema.get("type")
        if isinstance(t, list):
            non_null = [x for x in t if x != "null"]
            t = non_null[0] if non_null else None

        # Enum: pick the first non-null member.
        if "enum" in schema:
            for v in schema["enum"]:
                if v is not None:
                    return v
            return None

        if t == "string":
            return self._string_value(schema, prop_name)
        if t == "integer":
            return self._integer_value(schema, prop_name)
        if t == "number":
            return self._number_value(schema, prop_name)
        if t == "boolean":
            return self._boolean_value(prop_name)
        if t == "array":
            return self._array_value(schema, for_write, depth, seen)
        if t == "object" or "properties" in schema:
            return self._object_value(schema, for_write, depth, seen)

        # Unknown type — return None so the caller can drop the field.
        return None

    # ── helpers ──────────────────────────────────────────────────────────────

    def _resolve_ref(self, ref: str) -> dict[str, Any] | None:
        prefix = "#/components/schemas/"
        if not ref.startswith(prefix):
            return None
        return self.schemas.get(ref[len(prefix):])

    def _stub_iri(self, ref: str) -> str:
        # Use the schema name to derive a plausible IRI.
        name = ref.rsplit("/", 1)[-1].split(".")[0].split("-")[0]
        snake = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
        return f"/api/v1/{snake}s/1"

    def _string_value(self, schema: dict[str, Any], prop_name: str | None) -> str:
        fmt = schema.get("format")

        # Format-driven values.
        if fmt == "email":
            return self._email_for_field(prop_name)
        if fmt == "date-time":
            return PERSONA["anchor_datetime"]
        if fmt == "date":
            return PERSONA["anchor_date"]
        if fmt == "uuid":
            return "01938d8e-9c4f-7c2a-b8e1-3f7a9b8c4f12"
        if fmt == "iri-reference":
            return self._iri_for_field(prop_name)
        if fmt == "uri":
            return "https://civic-collective.example.com"
        if fmt == "uri-reference":
            return "/api/v1/users/42"
        if fmt == "binary":
            return "<binary data>"
        if fmt == "byte":
            return "iVBORw0KGgoAAAANS..."
        if fmt == "ipv4":
            return "192.0.2.42"
        if fmt == "ipv6":
            return "2001:db8::1"
        if fmt == "duration":
            return "PT1H"

        # Name-driven values: try exact match first, then token-match.
        if prop_name and prop_name in EXACT_STRING and EXACT_STRING[prop_name] is not None:
            return EXACT_STRING[prop_name]
        if prop_name:
            joined = _tokens_joined_lower(prop_name)  # e.g. "stripeAccount" -> "stripeaccount"
            tokens = _tokens(prop_name)               # e.g. ["stripe", "account"]
            for needle, value in TOKEN_STRING:
                # Match if the needle equals the full joined-lower name OR
                # equals any individual lower-cased token. This avoids the
                # substring trap (`ip` in `str[ip]e`) while still catching
                # both `email` and `inviterEmail`.
                if needle == joined or needle in tokens:
                    return value
            # Last-resort: try a substring match on the joined-lower name for
            # multi-token patterns that aren't a single camelCase segment
            # (e.g. `stripeaccount`, `webhookurl`).
            for needle, value in TOKEN_STRING:
                if " " in needle:
                    continue
                if needle in joined and len(needle) >= 6:
                    return value

        # Length-aware default for truly unknown string fields.
        max_len = schema.get("maxLength")
        if max_len and max_len < 10:
            return "ok"
        return "string"

    def _integer_value(self, schema: dict[str, Any], prop_name: str | None) -> int:
        if "minimum" in schema and "maximum" in schema:
            lo, hi = schema["minimum"], schema["maximum"]
            return lo if hi >= lo else hi
        if prop_name:
            lower = prop_name.lower()
            if lower == "id":
                return 42
            if "count" in lower:
                return 12
            if "page" in lower and "perpage" not in lower:
                return 1
            if "perpage" in lower or "pagesize" in lower:
                return 30
            if "amount" in lower or "price" in lower or "fee" in lower or "total" in lower:
                return 5000        # cents — Stripe convention
            if "duration" in lower:
                return 60
            if "age" in lower:
                return 34
            if "year" in lower:
                return 2026
            if "month" in lower:
                return 1
            if "day" in lower:
                return 15
            if "timestamp" in lower:
                return 1735689600
        return 42

    def _number_value(self, schema: dict[str, Any], prop_name: str | None) -> float:
        if prop_name:
            lower = prop_name.lower()
            if "lat" in lower:
                return 42.3601    # Boston
            if "long" in lower or "lng" in lower:
                return -71.0589
            if "amount" in lower or "price" in lower or "total" in lower:
                return 50.00
            if "rate" in lower or "percent" in lower:
                return 0.10
        return 12.5

    def _boolean_value(self, prop_name: str | None) -> bool:
        if not prop_name:
            return True
        lower = prop_name.lower()
        # Default-true for affirmative flags, default-false for "is-deleted"-style.
        for needle in ("isdeleted", "isarchived", "iscanceled", "iscancelled", "isexpired", "isvoid"):
            if needle in lower:
                return False
        return True

    def _array_value(self, schema: dict[str, Any], for_write: bool, depth: int, seen: frozenset[str]) -> list[Any]:
        items = schema.get("items", {})
        if not isinstance(items, dict):
            return []
        child = self.synthesize(items, for_write=for_write, depth=depth + 1, seen=seen)
        if child is None:
            return []
        # Two-element arrays are more illustrative than one-element ones for
        # collections; one-element keeps the example short.
        return [child]

    def _object_value(self, schema: dict[str, Any], for_write: bool, depth: int, seen: frozenset[str]) -> dict[str, Any] | None:
        props = schema.get("properties") or {}
        # Empty objects produce {} — but if the schema is a $ref-only object
        # with no properties, _maybe_object handles that upstream.
        result: dict[str, Any] = {}
        for name, sub in props.items():
            if not isinstance(sub, dict):
                continue
            if for_write and sub.get("readOnly"):
                continue
            if not for_write and sub.get("writeOnly"):
                continue
            val = self.synthesize(
                sub, for_write=for_write, prop_name=name, depth=depth + 1, seen=seen,
            )
            if val is not None:
                result[name] = val
        return result

    def _maybe_object(self, schema: dict[str, Any], for_write: bool, depth: int, seen: frozenset[str]) -> Any:
        if "properties" in schema:
            return self._object_value(schema, for_write, depth, seen)
        return {}

    # ── persona-aware helpers ────────────────────────────────────────────────

    def _email_for_field(self, prop_name: str | None) -> str:
        # Pick a persona based on prop name to make examples consistent across
        # contexts ("inviterEmail" -> different person than "inviteeEmail" etc.)
        if not prop_name:
            return f"{PERSONA['people'][0]['email_user']}@example.com"
        lower = prop_name.lower()
        people = PERSONA["people"]
        if "inviter" in lower or "owner" in lower or "creator" in lower or "admin" in lower:
            p = people[1]
        elif "invitee" in lower or "recipient" in lower or "target" in lower or "guest" in lower:
            p = people[2]
        elif "new" in lower:
            p = people[3]
        else:
            p = people[0]
        return f"{p['email_user']}@example.com"

    def _iri_for_field(self, prop_name: str | None) -> str:
        # Map property names to canonical IRI shapes for major entities.
        # If the schema already provided an `example`, the synthesize() loop
        # uses it instead of calling this.
        if not prop_name:
            return "/api/v1/users/42"
        lower = prop_name.lower()
        mapping = {
            "localcenter": "/api/v1/local_centers/4",
            "tenant": "/api/v1/tenants/1",
            "user": "/api/v1/users/42",
            "contact": "/api/v1/contacts/85",
            "event": "/api/v1/events/01938d8e-9c4f-7c2a-b8e1-3f7a9b8c4f12",
            "town": "/api/v1/towns/1",
            "country": "/api/v1/countries/1",
            "county": "/api/v1/counties/1",
            "role": "/api/v1/roles/12",
            "unit": "/api/v1/units/4",
            "company": "/api/v1/companies/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f88",
            "product": "/api/v1/products/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f99",
            "productprice": "/api/v1/product_prices/22",
            "productpayment": "/api/v1/product_payments/107",
            "contract": "/api/v1/contracts/9",
            "contractuser": "/api/v1/contract_users/63",
            "form": "/api/v1/forms/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f77",
            "course": "/api/v1/courses/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f55",
            "newsletter": "/api/v1/newsletters/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f44",
            "post": "/api/v1/posts/512",
            "discussion": "/api/v1/discussions/77",
            "media": "/api/v1/media_objects/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f33",
            "image": "/api/v1/media_objects/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f33",
            "logo": "/api/v1/media_objects/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f34",
            "cover": "/api/v1/media_objects/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f35",
            "badge": "/api/v1/badges/14",
            "professiontype": "/api/v1/profession_types/3",
            "professionindustry": "/api/v1/profession_industries/2",
            "customfield": "/api/v1/custom_fields/8",
            "customfieldvalue": "/api/v1/custom_field_values/2104",
            "webhooksubscription": "/api/v1/webhook_subscriptions/3",
            "project": "/api/v1/projects/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f66",
            "task": "/api/v1/tasks/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f67",
            "votecollection": "/api/v1/vote_collections/22",
            "vote": "/api/v1/votes/45",
            "drive": "/api/v1/drives/19",
            "emailtemplate": "/api/v1/email_templates/8",
            "widget": "/api/v1/widgets/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4f22",
            "invoice": "/api/v1/invoices/284",
            "adhesion": "/api/v1/adhesions/91",
            "identity": "/api/v1/identities/42",
            "subscriptionprofile": "/api/v1/subscription_profiles/55",
            "familyentity": "/api/v1/family_entities/8",
            "userrole": "/api/v1/user_roles/199",
            "userconnection": "/api/v1/user_connections/76",
            "courseenrollment": "/api/v1/course_enrollments/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4faa",
            "courselesson": "/api/v1/course_lessons/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4fbb",
            "coursequiz": "/api/v1/course_quizes/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4fcc",
            "profiletag": "/api/v1/profile_tags/14",
            "discussionnamespace": "/api/v1/discussion_namespaces/4",
            "feepayment": "/api/v1/fee_payments/512",
            "waitlistentry": "/api/v1/waitlist_entries/01938d8e-c2f4-7c2a-b8e1-3f7a9b8c4fdd",
        }
        for key, value in mapping.items():
            if key in lower:
                return value
        return "/api/v1/users/42"
