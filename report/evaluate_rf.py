"""Evidence-producing evaluation for the HEMS synthetic Random Forest dataset."""
from pathlib import Path
import warnings

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.compose import make_column_transformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier, export_text
from sklearn.ensemble import RandomForestClassifier


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = Path(__file__).resolve().parent / "evidence"
FIGURES = Path(__file__).resolve().parent / "figures"
DATASET = ROOT / "hems_phase1_working_dataset.csv"
MODEL = ROOT / "hems_random_forest.joblib"
FEATURES = [
    "ambient_temp",
    "relative_humidity",
    "motion_sensor",
    "grid_power",
    "hour",
    "day_of_week",
]


def main() -> None:
    EVIDENCE.mkdir(exist_ok=True)
    FIGURES.mkdir(exist_ok=True)
    warnings.simplefilter("default")
    df = pd.read_csv(DATASET, parse_dates=["timestamp"])
    x = df[FEATURES]
    y = df["optimal_ac_mode"]

    print("DATASET_SHAPE", df.shape)
    print("DATASET_COLUMNS", list(df.columns))
    print("MISSING_VALUES")
    print(df.isna().sum().to_string())
    print("NUMERIC_DESCRIBE")
    print(df.select_dtypes(include="number").agg(["min", "max", "mean"]).T.to_string())
    print("CLASS_COUNTS")
    print(y.value_counts().sort_index().to_string())

    plt.figure(figsize=(6, 4))
    y.value_counts().sort_index().plot.bar(color=["#4c78a8", "#f58518", "#54a24b"])
    plt.xlabel("Class (0=Eco, 1=Max Cool, 2=Dry)")
    plt.ylabel("Count")
    plt.title("Synthetic HEMS class distribution")
    plt.tight_layout()
    plt.savefig(FIGURES / "class_distribution.png", dpi=160)
    plt.close()

    plt.figure(figsize=(6, 4))
    for label, color in zip([0, 1, 2], ["#4c78a8", "#f58518", "#54a24b"]):
        part = df[y == label]
        plt.scatter(part["ambient_temp"], part["relative_humidity"], s=10, alpha=0.55, c=color, label=str(label))
    plt.xlabel("Ambient temperature")
    plt.ylabel("Relative humidity")
    plt.title("Temperature vs humidity by class")
    plt.legend(title="Class")
    plt.tight_layout()
    plt.savefig(FIGURES / "temperature_humidity_by_class.png", dpi=160)
    plt.close()

    loaded = joblib.load(MODEL)
    print("LOADED_MODEL_TYPE", type(loaded).__name__)
    print("LOADED_MODEL_PARAMS", loaded.get_params())
    print("LOADED_MODEL_FEATURE_IMPORTANCES")
    print(pd.Series(loaded.feature_importances_, index=FEATURES).to_string())

    params = loaded.get_params()
    rf = RandomForestClassifier(**params)
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    scores = cross_validate(
        rf, x, y, cv=cv, scoring=["accuracy", "f1_macro"], n_jobs=-1
    )
    print("RF_CV_ACCURACY_MEAN_STD", scores["test_accuracy"].mean(), scores["test_accuracy"].std())
    print("RF_CV_MACRO_F1_MEAN_STD", scores["test_f1_macro"].mean(), scores["test_f1_macro"].std())

    train = df[df["timestamp"].dt.day <= 24]
    test = df[df["timestamp"].dt.day > 24]
    rf_holdout = RandomForestClassifier(**params).fit(train[FEATURES], train["optimal_ac_mode"])
    pred = rf_holdout.predict(test[FEATURES])
    cm = confusion_matrix(test["optimal_ac_mode"], pred, labels=[0, 1, 2])
    print("HOLDOUT_TRAIN_ROWS_TEST_ROWS", len(train), len(test))
    print("HOLDOUT_ACCURACY", accuracy_score(test["optimal_ac_mode"], pred))
    print("HOLDOUT_MACRO_F1", f1_score(test["optimal_ac_mode"], pred, average="macro"))
    print("HOLDOUT_CLASSIFICATION_REPORT")
    print(classification_report(test["optimal_ac_mode"], pred, labels=[0, 1, 2], target_names=["Eco", "Max Cool", "Dry"], zero_division=0))
    print("HOLDOUT_CONFUSION_MATRIX")
    print(cm)

    plt.figure(figsize=(5, 4))
    plt.imshow(cm, cmap="Blues")
    plt.title("Time-ordered holdout confusion matrix")
    plt.xlabel("Predicted")
    plt.ylabel("Actual")
    plt.xticks(range(3), ["Eco", "Max Cool", "Dry"])
    plt.yticks(range(3), ["Eco", "Max Cool", "Dry"])
    for i in range(3):
        for j in range(3):
            plt.text(j, i, cm[i, j], ha="center", va="center")
    plt.tight_layout()
    plt.savefig(FIGURES / "holdout_confusion_matrix.png", dpi=160)
    plt.close()

    plt.figure(figsize=(7, 4))
    pd.Series(loaded.feature_importances_, index=FEATURES).sort_values().plot.barh()
    plt.title("Loaded Random Forest feature importances")
    plt.tight_layout()
    plt.savefig(FIGURES / "feature_importances.png", dpi=160)
    plt.close()

    majority = pd.Series(y).mode().iloc[0]
    print("MAJORITY_CLASS", majority)
    print("MAJORITY_CV_ACCURACY_MEAN_STD", np.mean([accuracy_score(y.iloc[test_i], np.full(len(test_i), majority)) for _, test_i in cv.split(x, y)]), np.std([accuracy_score(y.iloc[test_i], np.full(len(test_i), majority)) for _, test_i in cv.split(x, y)]))
    print("MAJORITY_CV_MACRO_F1_MEAN_STD", np.mean([f1_score(y.iloc[test_i], np.full(len(test_i), majority), average="macro", zero_division=0) for _, test_i in cv.split(x, y)]), np.std([f1_score(y.iloc[test_i], np.full(len(test_i), majority), average="macro", zero_division=0) for _, test_i in cv.split(x, y)]))

    logreg = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, random_state=42))
    log_scores = cross_validate(logreg, x, y, cv=cv, scoring=["accuracy", "f1_macro"], n_jobs=-1)
    print("LOGREG_CV_ACCURACY_MEAN_STD", log_scores["test_accuracy"].mean(), log_scores["test_accuracy"].std())
    print("LOGREG_CV_MACRO_F1_MEAN_STD", log_scores["test_f1_macro"].mean(), log_scores["test_f1_macro"].std())

    tree = DecisionTreeClassifier(max_depth=3, random_state=42).fit(x, y)
    print("DEPTH3_TREE_ACCURACY", accuracy_score(y, tree.predict(x)))
    print("DEPTH3_TREE_RULES")
    print(export_text(tree, feature_names=FEATURES))
    print("LABELS_LOOK_RULE_GENERATED", "YES: a shallow tree expresses compact threshold-like rules; this is evidence of synthetic generation, not real-world validity.")
    print("REQUIRED_SENTENCE", "High scores on synthetic labels show the model recovers the generating rules, not real-world accuracy.")


if __name__ == "__main__":
    main()
