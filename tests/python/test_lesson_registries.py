"""
tests/python/test_lesson_registries.py
Tests for the universal screen + command registries (W2.5).
Golden Rule #10: hardcode TYPES, never content.
"""

from google_agent.registry.lesson_registries import (
    CATEGORY_COMMAND_HINTS,
    COMMAND_REGISTRY,
    COMMAND_TYPES,
    DOMAIN_DECO_THEMES,
    DOMAIN_SCREEN_FAMILIES,
    SCREEN_REGISTRY,
    UNIVERSAL_CATEGORIES,
    all_screen_types,
    category_of,
    is_valid_command_type,
    is_valid_screen_type,
    screen_types_for_domain,
)


class TestScreenRegistry:
    def test_total_count_is_154(self):
        total = sum(len(v) for v in SCREEN_REGISTRY.values())
        assert total == 154, f"Registry must hold exactly 154 types, got {total}"

    def test_category_sizes_match_design(self):
        expected = {
            "lesson_start": 8, "source_grounded": 10, "explanation": 12,
            "visual_model": 12, "worked_example": 10,
            "sql_database": 10, "programming": 10, "math": 10,
            "biology_science": 10, "finance_econ": 10, "history_law": 10,
            "interaction": 13, "mistake_repair": 10, "summary_book": 12,
            "decoration": 7,
        }
        for cat, n in expected.items():
            assert len(SCREEN_REGISTRY[cat]) == n, f"{cat}: {len(SCREEN_REGISTRY[cat])} != {n}"

    def test_no_duplicate_types_across_registry(self):
        flat = [t for types in SCREEN_REGISTRY.values() for t in types]
        assert len(flat) == len(set(flat)), "duplicate screen types found"

    def test_no_content_only_type_names(self):
        """Golden Rule #10 — registry holds type names, never lesson content."""
        for types in SCREEN_REGISTRY.values():
            for t in types:
                assert " " not in t and t == t.lower(), f"not a type name: {t!r}"


class TestDomainSelection:
    def test_sql_domain_gets_sql_family(self):
        types = screen_types_for_domain("sql")
        assert "star_schema_fact_dimension" in types
        assert "join_bridge_animation" in types

    def test_math_domain_gets_math_family_not_sql(self):
        types = screen_types_for_domain("math")
        assert "equation_derivation" in types
        assert "join_bridge_animation" not in types

    def test_every_domain_gets_universal_categories(self):
        for domain in ("sql", "math", "biology", "history", "general"):
            types = screen_types_for_domain(domain)
            assert "learning_objective" in types      # lesson_start
            assert "pdf_crop_zoom" in types            # source_grounded
            assert "misconception_repair" in types     # mistake_repair
            assert "lesson_book_page" in types         # summary_book

    def test_unknown_domain_falls_back_to_general(self):
        types = screen_types_for_domain("astrology_nonsense")
        assert "learning_objective" in types

    def test_every_domain_has_deco_theme(self):
        for family in set(DOMAIN_SCREEN_FAMILIES.values()):
            if family in ("explanation",):
                continue
            assert family in DOMAIN_DECO_THEMES


class TestCommandRegistry:
    def test_exactly_12_command_types(self):
        assert len(COMMAND_TYPES) == 12

    def test_design_commands_present(self):
        for cmd in ("movePointer", "circle", "showPdfCrop", "zoomRegion",
                    "askStudent", "revealAnswer", "saveBookPage"):
            assert is_valid_command_type(cmd)

    def test_every_command_has_description(self):
        for cmd, desc in COMMAND_REGISTRY.items():
            assert len(desc) > 10

    def test_category_hints_use_only_valid_commands(self):
        for cat, cmds in CATEGORY_COMMAND_HINTS.items():
            for cmd in cmds:
                assert is_valid_command_type(cmd), f"{cat} hints invalid {cmd}"

    def test_decoration_screens_get_no_commands(self):
        assert CATEGORY_COMMAND_HINTS["decoration"] == []


class TestHelpers:
    def test_all_screen_types_flat_and_complete(self):
        assert len(all_screen_types()) == 154

    def test_is_valid_screen_type(self):
        assert is_valid_screen_type("pdf_crop_zoom")
        assert not is_valid_screen_type("made_up_screen")

    def test_category_of(self):
        assert category_of("pdf_crop_zoom") == "source_grounded"
        assert category_of("recursion_tree") == "programming"
        assert category_of("nope") == ""
