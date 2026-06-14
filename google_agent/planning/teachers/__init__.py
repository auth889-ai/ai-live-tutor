"""Domain teacher registry — maps domain strings to teacher classes."""

from .sql_database_teacher import SQLDatabaseTeacher
from .math_teacher import MathTeacher
from .coding_teacher import CodingTeacher
from .biology_science_teacher import BiologyScienceTeacher
from .finance_econ_teacher import FinanceEconTeacher
from .history_law_teacher import HistoryLawTeacher
from .ai_ml_teacher import AiMlTeacher
from .universal_teacher import UniversalTeacher

TEACHER_REGISTRY = {
    "sql_database":    SQLDatabaseTeacher,
    "math":            MathTeacher,
    "programming":     CodingTeacher,
    "biology_science": BiologyScienceTeacher,
    "finance_econ":    FinanceEconTeacher,
    "history_law":     HistoryLawTeacher,
    "ai_ml":           AiMlTeacher,
    "general":         UniversalTeacher,
}


def get_teacher(domain: str):
    """Return instantiated teacher for domain. Raises if domain unknown."""
    cls = TEACHER_REGISTRY.get(domain)
    if cls is None:
        raise ValueError(
            f"No teacher for domain '{domain}'. "
            f"Valid: {list(TEACHER_REGISTRY.keys())}"
        )
    return cls()
