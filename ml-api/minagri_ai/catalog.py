"""e-Soko commodity catalog and market registry."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache

from .config import CATALOG_PATH


@dataclass(frozen=True)
class Commodity:
    id: int
    code: str
    name: str
    local: str
    french: str
    unit: str
    archived: bool
    reference_farmgate: float

    @property
    def aliases(self) -> list[str]:
        seen = {self.name.lower()}
        out = []
        for alias in (self.local, self.french):
            if alias and alias.lower() not in seen:
                seen.add(alias.lower())
                out.append(alias)
        return out


@dataclass(frozen=True)
class Market:
    id: int
    code: str
    name: str
    source: str
    district: str
    province: str
    registry_province: str | None

    @property
    def aliases(self) -> list[str]:
        return [self.source] if self.source.lower() != self.name.lower() else []


@dataclass
class Catalog:
    source: str
    commodities: list[Commodity]
    archived: list[Commodity]
    markets: list[Market]
    notes: list[str]
    ambiguous_local_names: set[str] = field(default_factory=set)

    @property
    def provinces(self) -> list[str]:
        return sorted({m.province for m in self.markets if m.province})

    def market(self, name: str) -> Market | None:
        return self._market_index.get(name)

    def commodity(self, name: str) -> Commodity | None:
        return self._commodity_index.get(name)

    def archived_by_name(self, name: str) -> Commodity | None:
        return self._archived_index.get(name.strip().lower())

    def __post_init__(self) -> None:
        self._market_index = {m.name: m for m in self.markets}
        self._commodity_index = {c.name: c for c in self.commodities}
        self._archived_index = {}
        for c in self.archived:
            for n in (c.name, c.french):
                if n:
                    self._archived_index[n.lower()] = c


@lru_cache(maxsize=1)
def load_catalog() -> Catalog:
    raw = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    all_commodities = [
        Commodity(
            id=c["id"],
            code=str(c.get("code") or ""),
            name=c["name"],
            local=c.get("local") or "",
            french=c.get("french") or "",
            unit=c.get("unit") or "kg",
            archived=bool(c.get("archived")),
            reference_farmgate=float(c.get("referenceFarmgate") or 0),
        )
        for c in raw["commodities"]
    ]
    markets = [
        Market(
            id=m["id"],
            code=str(m.get("code") or ""),
            name=m["name"],
            source=m.get("source") or m["name"],
            district=m.get("district") or "",
            province=m.get("province") or "",
            registry_province=m.get("registryProvince"),
        )
        for m in raw["markets"]
    ]
    active = [c for c in all_commodities if not c.archived]
    # archived products count too: "Amateke" is both Taro (active) and Yams (archived)
    local_count: dict[str, int] = {}
    for c in all_commodities:
        if c.local:
            local_count[c.local.lower()] = local_count.get(c.local.lower(), 0) + 1
    return Catalog(
        source=raw.get("source", "e-Soko"),
        commodities=active,
        archived=[c for c in all_commodities if c.archived],
        markets=markets,
        notes=list(raw.get("notes", [])),
        ambiguous_local_names={k for k, n in local_count.items() if n > 1},
    )
